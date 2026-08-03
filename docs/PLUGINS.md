# Samvad — Plugin Architecture

The goal: a contributor should be able to add background blur, a whiteboard, live
captions, or a reaction system **without touching Samvad's core** — and a user should be
able to install that plugin without extending any trust to its author.

Those two goals are in tension. The resolution is a capability-based permission model,
borrowed from browser extensions and enforced by the runtime rather than by convention.

---

## 1. The contract

```ts
export interface SamvadPlugin {
  readonly id: string          // reverse-DNS: "org.samvad.blur"
  readonly name: string
  readonly version: string     // semver
  readonly author?: string
  readonly capabilities: readonly Capability[]   // requested up front, immutable
  setup(ctx: PluginContext): void | Promise<void>
  teardown?(): void | Promise<void>
}
```

`capabilities` is a manifest, declared before the plugin runs. The host grants exactly
what's listed and nothing more. A plugin that never declares `network` **cannot make a
network request** — not "shouldn't", *cannot*: it runs in a worker with `fetch`,
`XMLHttpRequest`, `WebSocket`, and `EventSource` removed from its global scope.

```ts
type Capability =
  | { type: 'video-transform' }                              // read/write outgoing video frames
  | { type: 'audio-transform' }                              // read/write outgoing audio frames
  | { type: 'ui'; slot: UiSlot }                             // render into a defined region
  | { type: 'data'; topic: string }                          // send/receive on one E2EE topic
  | { type: 'lifecycle' }                                    // observe join/leave/mute events
  | { type: 'storage' }                                      // scoped, client-side only
  | { type: 'network'; origins: readonly string[] }          // ⚠️ requires explicit user consent

type UiSlot = 'toolbar' | 'sidebar' | 'stage-overlay' | 'tile-overlay' | 'settings'
```

**The `network` capability is the entire security model.** A blur plugin that requests it
is immediately suspicious, and the UI says so in those terms. Effects have no business
talking to the internet.

---

## 2. Media pipeline plugins

Video and audio transforms are the plugin type most contributors will write, so this is
the path that gets the most care.

Frames flow through an ordered chain, entirely on-device, **before** encryption and
transmission:

```
camera ─► [ transform₁ ] ─► [ transform₂ ] ─► ... ─► E2EE encrypt ─► SFU
             blur           color-correct
```

```ts
export interface VideoTransform {
  init(ctx: {
    width: number
    height: number
    gl: WebGL2RenderingContext     // shared context, already bound
    signal: AbortSignal
  }): Promise<void>

  /** Return the transformed frame, or `null` to drop it. MUST close the input frame. */
  transform(frame: VideoFrame): Promise<VideoFrame | null>

  dispose(): void
}
```

### Non-negotiable rules

1. **Runs in a Web Worker.** Uses `MediaStreamTrackProcessor` / `MediaStreamTrackGenerator`.
   The main thread never blocks, so the UI stays at 60fps even when a transform stalls
2. **Frame budget: 16ms at 30fps.** The host measures every transform. Blow the budget
   three times in a row and the host disables the plugin and surfaces *which* one and
   *why* — a slow plugin degrades itself, never the call
3. **Close your frames.** `VideoFrame` holds GPU memory that GC will not reclaim.
   A leak here kills the tab in under a minute. The host asserts this in dev builds
4. **Shared WebGL context.** Ten plugins must not mean ten GL contexts

### Reference plugin: background blur

```ts
export default {
  id: 'org.samvad.blur',
  name: 'Background Blur',
  version: '1.0.0',
  capabilities: [{ type: 'video-transform' }, { type: 'ui', slot: 'settings' }],

  setup(ctx) {
    ctx.registerVideoTransform(new BlurTransform(), { order: 100 })
    ctx.registerSettings(BlurSettingsPanel)
  },
} satisfies SamvadPlugin
```

Segmentation runs as a **bundled WASM model** — shipped with the plugin, executed
locally, never fetched at runtime. This is why blur doesn't need `network`, and it's
exactly the property that makes the permission model meaningful rather than decorative.
Users can swap the model; that's the point of a plugin system.

---

## 3. UI plugins

```ts
ctx.registerPanel({
  slot: 'sidebar',
  icon: ChatIcon,
  label: 'Whiteboard',
  component: WhiteboardPanel,   // a React component
})
```

UI plugins receive Samvad's design tokens and primitives, so a third-party panel looks
native without its author reverse-engineering the visual language. They get **no direct
DOM access outside their slot** and cannot read or modify other plugins' regions.

---

## 4. Data plugins

Anything collaborative — polls, whiteboard sync, hand-raise, captions — moves over a
scoped data-channel topic:

```ts
ctx.data.on((msg: Uint8Array, from: PeerId) => { /* ... */ })
ctx.data.send(encode({ stroke }))          // broadcast to the room
ctx.data.send(payload, { to: peerId })     // or to one peer
```

Topics are namespaced by plugin id, so plugins cannot read each other's traffic. Payloads
ride the **same E2EE envelope as media** — the server relays ciphertext it cannot read.
A whiteboard built on Samvad is end-to-end encrypted for free, without its author writing
a line of crypto.

---

## 5. Server-side plugins — deliberately constrained

Some features genuinely need the server: SIP dial-in, server-side recording, cloud
transcription. Each one **breaks a promise Samvad makes**, so they are quarantined:

- Distributed separately, never bundled in the default binary
- Loading one prints a startup banner naming the guarantee it voids
- Any participant can query which server plugins are loaded, and the answer is shown in
  the room's privacy indicator — not buried in a settings page
- Recording plugins **must** trigger a visible, unmutable, non-dismissable room-wide
  indicator. No exceptions, and no configuration flag to suppress it

The default build has zero server plugins, and `samvad --version` says so.

---

## 6. Distribution

Plugins are ES modules with a manifest, loaded from a URL or a local file:

```
samvad-blur/
├── manifest.json      # id, version, capabilities, integrity hash
├── plugin.js          # ES module, default-exports SamvadPlugin
└── model.wasm         # bundled assets
```

- **No central registry, no gatekeeper.** A plugin is a URL. Hosting one requires nobody's
  permission — which is the whole reason for open source
- Manifests carry a **SHA-256 integrity hash**; the host refuses a mismatch
- Install shows the capability list in plain language *before* the code ever runs:
  *"Background Blur wants to: modify your camera video. It cannot access the network."*

---

## 7. Versioning

The plugin API is **semver, and its stability is a promise to contributors.** Breaking it
casually is how plugin ecosystems die.

- `SAMVAD_PLUGIN_API` is exposed as a version constant; manifests declare a compatible range
- Deprecations warn for one full minor cycle before removal
- Plugins targeting an incompatible major are refused to load with a clear message rather
  than crashing halfway through a call

---

## 8. Which parts of Samvad are themselves plugins?

As many as can survive it. Every first-party feature built on the public API is a
continuous, unforgiving test of that API's adequacy:

| Ships as a plugin | Stays in core |
|---|---|
| Background blur / replace | Transport (mesh, SFU) |
| Noise suppression | E2EE and key management |
| Chat | Plugin host and permission enforcement |
| Reactions, hand-raise | Media capture and device handling |
| Whiteboard | Stage layout engine |
| Live captions | Design system |
| Grid / spotlight layout presets | Signalling |

If background blur can't be written through the public plugin API, the API is wrong —
and the fix is to improve the API, never to grant blur a private back door.
