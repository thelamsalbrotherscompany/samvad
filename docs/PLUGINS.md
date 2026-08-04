# Samvad — Plugin Architecture

> **Building a plugin?** This document is the *design* — the full contract and the security
> model it's heading toward. For a practical, accurate "write one today" guide against what
> is **actually implemented right now**, start with
> [`PLUGIN-AUTHORING.md`](PLUGIN-AUTHORING.md).

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
the path that gets the most care. A transform runs entirely on-device, **before**
encryption and transmission; its output track is what peers receive:

```
camera track ─► [ video-transform ] ─► published track ─► E2EE ─► peers / SFU
                    (e.g. blur)
```

### The contract (as built)

A media plugin declares a `video-transform` and/or `audio-transform` capability and, in
`setup`, registers a `TrackTransform` through `ctx.media`:

```ts
export interface TrackTransform {
  /** Begin processing the raw track; return the track to publish. Return synchronously so
   *  there's no gap — show raw passthrough on the returned track until any model loads.
   *  The plugin may run a Web Worker internally. */
  start(input: MediaStreamTrack): MediaStreamTrack | Promise<MediaStreamTrack>
  /** Stop and release everything. The host reverts to the raw track. */
  stop(): void
}
```

The plugin owns the whole pipeline — segmentation, compositing, any worker — and hands the
host a finished track. The host stays transform-agnostic: it publishes whatever track is
registered, or the raw one when nothing is.

### The media-plugin host runs from pre-join

Local camera and mic exist *before* you're admitted, so media plugins load at the app root
and are live in the pre-join preview — separately from the in-room host that carries chat
and reactions (those need the room). A media plugin may use only the `settings` UI slot
(§3); toolbar/tile/stage belong to in-room plugins.

### Register only while wanted

`registerVideoTransform` / `registerAudioTransform` return an **unregister** function.
Register when the effect turns on and unregister when off — with nothing registered the
host publishes the raw track, so an idle effect costs zero frames.

### Rules

1. **Never block the main thread.** A transform doing heavy work (segmentation, shaders)
   should run it in a **Web Worker** with a **WebGL2 / `OffscreenCanvas`** compositor,
   falling back to a main-thread path only where those APIs are unavailable.
2. **The host guards the budget.** It watches the published track; if a transform's output
   cadence collapses it reverts to the raw camera rather than let one plugin drag the call
   down — a slow effect degrades itself, never the meeting.
3. **Models ship with the plugin.** Segmentation runs as a **bundled WASM model** — executed
   locally, never fetched at runtime. This is why blur needs no `network`, and it's what
   makes the permission model meaningful rather than decorative. Users can swap the model;
   that's the point of a plugin system.

### Reference plugin: background effects

```ts
export default {
  id: 'org.samvad.background',
  name: 'Background effects',
  version: '1.0.0',
  capabilities: [{ type: 'video-transform' }, { type: 'ui', slot: 'settings' }],

  setup(ctx) {
    ctx.ui?.registerSettingsPanel(BackgroundSettings)
    let off: (() => void) | null = null
    // Register the transform only while an effect is chosen; drop it when off.
    const sync = () => {
      const wants = wantsEffect(store.getState())
      if (wants && !off) off = ctx.media?.registerVideoTransform(new BackgroundTransform()) ?? null
      else if (!wants && off) { off(); off = null }
    }
    sync()
    store.subscribe(sync)
  },
} satisfies SamvadPlugin
```

`web/src/plugins/background/` is exactly this — blur, strong-blur, and virtual-background
image, built on the public API only. It's the dogfood proof that `video-transform` is real.

### Where this is headed

For **untrusted** third-party plugins the target is a stricter, host-owned frame pipeline:
one shared Web Worker with a single WebGL2 context and a per-frame
`transform(frame: VideoFrame): VideoFrame | null` contract under a hard 16 ms budget — so a
plugin can neither hold a raw camera track nor leak `VideoFrame`s. First-party, in-process
plugins use the track-level contract above today; the frame-level model lands with the
Worker sandbox (§7, Phase 6).

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
