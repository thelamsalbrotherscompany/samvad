# Writing a Samvad Plugin

This is the practical, **build-one-today** guide. It documents the plugin API *as it is
actually implemented right now*. For the full design vision — the untrusted-plugin Worker
sandbox, the `network` permission model, the frame-level media pipeline, and URL-based
distribution — see [`PLUGINS.md`](PLUGINS.md); those parts are specified but **not yet
enforced**.

The one rule that matters: **a plugin uses only the public plugin API and the design
system. It never imports from `core/` (except the plugin types) and never reaches into the
transport, media, or signalling.** Every first-party feature obeys this — reactions and
chat are both plugins — so the API stays honest.

---

## What works today

| Capability | Status | Notes |
|---|---|---|
| `data` (E2EE topic) | ✅ | send/receive over the P2P channel, namespaced per plugin |
| `ui` → `toolbar` | ✅ | a control in the bottom control bar |
| `ui` → `tile-overlay` | ✅ | a component drawn on every participant tile |
| `ui` → `stage-overlay` | ✅ | a component drawn over the whole stage |
| `ui` → `settings` | ✅ | a section in the Settings dialog (`ctx.ui.registerSettingsPanel`) |
| `video-transform` / `audio-transform` | ✅ | a `TrackTransform` via `ctx.media`; runs from pre-join |
| `ui` → `sidebar` | ⛔ | slot name exists; not mounted yet (use `toolbar` + your own panel) |
| `lifecycle` | ⛔ | declared in the types; not yet delivered to plugins |
| `storage` | ⚠️ | `ctx.storage` — namespaced, `sessionStorage`-backed (tab-lifetime). Gated, but a *convention* in-process (see below) |
| `network` | ⚠️ | `ctx.net.fetch` — restricted to declared origins. Gated, but a *convention* in-process; consent UI is future |
| Worker sandbox / integrity / URL loading | ⛔ | first-party, in-process only for now |

> **Honest limit:** because plugins run **in-process**, `storage`/`network` gating is a
> *convention and a portability shim, not a boundary* — a plugin still has ambient `fetch` /
> `localStorage`. Use `ctx.storage` / `ctx.net` anyway: they namespace/origin-restrict your
> code so it's ready for the Worker sandbox (Phase 6), where the ambient globals are removed
> and only these — checked against your manifest — work. Until then, only run plugins you'd
> trust as source.

Plugins currently run **in-process** and are **registered in code** (an array in the app),
not loaded from a URL. That's enough to build and ship first-party features through the
same API third parties will eventually use.

There are two registration arrays in `web/src/App.tsx`, because two things have different
lifetimes: **`PLUGINS`** (in-room — `data` and toolbar/tile/stage UI, mounted once you're
admitted) and **`MEDIA_PLUGINS`** (`video-transform` / `audio-transform` + the `settings`
slot, running at the app root so an effect is live from the pre-join preview). Put a plugin
in whichever list matches the capabilities it uses.

---

## Quickstart: a complete plugin

A "wave" plugin — a toolbar button that waves at the room, and a toast when someone waves
back. It uses one data topic and two UI slots, and imports nothing from `core/` but the
public types.

```tsx
// web/src/plugins/wave/index.tsx
import { useEffect, useState } from 'react'
import type { SamvadPlugin } from '@/core/plugins/types'
import { HandIcon } from '@/design/icons'

// Bound in setup() so the components can reach the room without prop-drilling ctx.
let broadcast: ((payload: unknown) => void) | undefined
let myName = ''
let showToast: ((name: string) => void) | undefined

function WaveButton() {
  return (
    <button
      aria-label="Wave"
      onClick={() => broadcast?.({ from: myName })}
      className="inline-grid size-10 place-items-center rounded-full text-ink-muted transition hover:bg-surface-2 hover:text-ink"
    >
      <span className="size-4.75 [&_svg]:size-full">
        <HandIcon />
      </span>
    </button>
  )
}

function WaveToast() {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    showToast = (n) => {
      setName(n)
      setTimeout(() => setName(null), 1500)
    }
    return () => {
      showToast = undefined
    }
  }, [])
  if (!name) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center">
      <span className="rounded-full bg-surface/90 px-3 py-1.5 text-[13px] text-ink shadow-lg backdrop-blur">
        👋 {name} waved
      </span>
    </div>
  )
}

const wavePlugin: SamvadPlugin = {
  id: 'com.example.wave', // reverse-DNS, globally unique
  name: 'Wave',
  version: '1.0.0',
  capabilities: [
    { type: 'data', topic: 'wave' },
    { type: 'ui', slot: 'toolbar' },
    { type: 'ui', slot: 'stage-overlay' },
  ],

  setup(ctx) {
    broadcast = (payload) => ctx.data?.send(payload)
    myName = ctx.selfName
    ctx.data?.on((payload) => {
      const from = (payload as { from?: unknown }).from
      if (typeof from === 'string') showToast?.(from)
    })
    ctx.ui?.registerToolbarControl(WaveButton)
    ctx.ui?.registerStageOverlay(WaveToast)
  },

  teardown() {
    broadcast = undefined
    showToast = undefined
  },
}

export default wavePlugin
```

Then register it (one line — see [Registering](#registering-your-plugin)) and it's live in
the next call.

---

## The contract

```ts
interface SamvadPlugin {
  readonly id: string          // reverse-DNS, e.g. "org.samvad.reactions" — must be unique
  readonly name: string
  readonly version: string     // semver
  readonly author?: string
  readonly capabilities: readonly Capability[]  // declared up front, immutable
  setup(ctx: PluginContext): void | Promise<void>
  teardown?(): void | Promise<void>
}
```

- **`setup(ctx)`** runs once, when a call starts. Register everything here.
  **Keep it synchronous** — registrations must land before the first paint; an `async`
  `setup`'s late registrations won't appear.
- **`teardown()`** runs when the call ends. Undo module-level bindings and clear state.
- `capabilities` is a manifest. The host builds `ctx` from **only** what you declare: a
  sub-API you didn't request isn't attached, and a UI slot you didn't declare **throws** if
  you try to use it.

---

## The `PluginContext`

```ts
interface PluginContext {
  readonly selfId: string    // your own participant id (matches your self tile)
  readonly selfName: string  // your display name — label your own outgoing messages with it

  data?: {
    send(payload: unknown, opts?: { to?: string }): void
    on(handler: (payload: unknown, from: string) => void): () => void
  }

  ui?: {
    registerToolbarControl(component: ComponentType): void
    registerTileOverlay(component: ComponentType<{ participant: TileParticipant }>): void
    registerStageOverlay(component: ComponentType): void
  }
}

type TileParticipant = { id: string; name: string; isSelf: boolean }
```

`ctx.data` is present only if you declared a `data` capability; `ctx.ui`'s methods only work
for the slots you declared. Use optional chaining (`ctx.data?.send(...)`) so the types stay
happy.

### Data topics (E2EE messaging)

`data` rides the **same peer-to-peer, end-to-end-encrypted channel as media** — the
signalling server never sees it. Your topic is **namespaced by your plugin id**, so two
plugins can't read each other's traffic.

```ts
ctx.data?.send({ hi: true })                 // broadcast to the room
ctx.data?.send({ hi: true }, { to: peerId }) // or to one peer
const off = ctx.data?.on((payload, from) => { /* from = sender's participant id */ })
```

- **Your own sends are not echoed back to you.** If you need a local effect (e.g. show your
  own reaction), do it yourself when you call `send`.
- Payloads are JSON — anything `JSON.stringify` can handle. **Validate on receipt**; treat
  `payload` as untrusted (`typeof x.field === 'string'`, etc.).
- There's **no history**: a late joiner only sees messages sent after they arrive.

### UI slots

Register a plain React component. It gets the design tokens and primitives, so it looks
native. It has no DOM access outside its slot.

| Slot | Where it renders | Shape |
|---|---|---|
| `toolbar` | the bottom control bar (hidden when you're alone in the room) | `() => JSX` |
| `tile-overlay` | inside **every** participant tile | `({ participant }) => JSX` |
| `stage-overlay` | over the whole stage | `() => JSX` |

Positioning notes:
- **tile-overlay**: the tile is a CSS container-query context — size with `cqmin` units
  (e.g. `min(20cqmin, 52px)`) so you scale from a thumbnail to a full-screen tile. Position
  `absolute`; use `pointer-events-none` unless you need clicks. Key on `participant.id` and
  keep per-participant state in your own store.
- **stage-overlay**: position `absolute` against the room; `pointer-events-none` unless
  interactive.
- Prefer design tokens (`text-ink`, `bg-surface`, `text-accent`, …) over hardcoded colors,
  and respect `prefers-reduced-motion` (the app collapses animation to 0ms globally, so use
  CSS `animation` and you get this for free).

---

## Registering your plugin

Plugins are loaded from a **static array** in the app (URL loading comes later):

```ts
// web/src/App.tsx
import reactionsPlugin from '@/plugins/reactions'
import chatPlugin from '@/plugins/chat'
import wavePlugin from '@/plugins/wave' // ← your data/UI plugin

const PLUGINS = [reactionsPlugin, chatPlugin, wavePlugin]

// Media-transform + settings plugins go here instead — they run from pre-join.
const MEDIA_PLUGINS = [backgroundPlugin]
```

That's the whole loop: drop a folder in `web/src/plugins/`, add one import + array entry,
and it's live in the next call. For an in-room (`data` / toolbar / tile / stage) plugin,
`setup` runs when a call starts and `teardown` when it ends; a media plugin in `MEDIA_PLUGINS`
sets up at the app root instead, so its effect and settings are live in the pre-join preview.

---

## Rules (so a plugin can't misbehave)

1. **Only public imports.** `@/core/plugins/types` for the contract, `@/design/*` for the
   UI kit, and third-party libraries. **Never** `@/core/transport`, `@/core/media`,
   `@/core/room`, etc. If you find yourself needing one, the public API is missing something
   — that's a bug in the API to fix, not a door to open.
2. **Own your state.** Keep plugin state in a module-scoped store (Zustand is already a
   dependency and is what reactions/chat use). Reset it in `teardown`.
3. **Validate received data.** It comes from other participants.
4. **Clean up in `teardown`.** Unbind module singletons, clear stores, drop timers.
5. **Namespace your topic and id.** Use a reverse-DNS id you control.

---

## Writing a media-transform plugin

A `video-transform` (or `audio-transform`) plugin registers a `TrackTransform` through
`ctx.media`: given the raw camera/mic track, it returns a processed one. The plugin owns
the whole pipeline (segmentation, compositing, any Web Worker) and may use the `settings`
slot for its controls. Register **only while the effect is wanted** — the returned
unregister fn turns it off, and the host then publishes the raw track (an idle effect costs
nothing).

```ts
import type { SamvadPlugin, TrackTransform } from '@/core/plugins/types'

class BlurTransform implements TrackTransform {
  start(input: MediaStreamTrack): MediaStreamTrack {
    // …build your pipeline; return the processed track (raw passthrough until ready)…
  }
  stop() { /* release everything */ }
}

const blurPlugin: SamvadPlugin = {
  id: 'com.example.blur',
  name: 'Blur',
  version: '1.0.0',
  capabilities: [{ type: 'video-transform' }, { type: 'ui', slot: 'settings' }],
  setup(ctx) {
    ctx.ui?.registerSettingsPanel(BlurSettings)
    let off: (() => void) | null = null
    const sync = () => {
      const on = store.getState().enabled
      if (on && !off) off = ctx.media?.registerVideoTransform(new BlurTransform()) ?? null
      else if (!on && off) { off(); off = null }
    }
    sync()
    store.subscribe(sync)
  },
}
```

Add it to `MEDIA_PLUGINS`, not `PLUGINS`. `web/src/plugins/background/` is a complete
working example.

---

## Learn from the built-ins

All three are small, complete, and use nothing but the public API:

- **`web/src/plugins/reactions/`** — a `data` topic + `toolbar` + `tile-overlay`. Shows
  per-participant tile overlays and keying local state to `selfId` / sender id.
- **`web/src/plugins/chat/`** — a `data` topic + `toolbar`. Shows a plugin that owns its own
  button, unread badge, and panel entirely within the `toolbar` slot — proof you don't need
  a dedicated panel slot to build a rich panel.
- **`web/src/plugins/background/`** — a `video-transform` + `settings` slot. Shows a media
  plugin that owns its segmentation/compositing pipeline (and a Web Worker) and registers a
  `TrackTransform` only while an effect is on.
- **`web/src/plugins/noise/`** — an `audio-transform` + `settings` slot. A noise gate from
  standard Web Audio nodes; the same register-while-enabled shape as background.

---

## Not available yet (planned — see `PLUGINS.md`)

- **The `lifecycle` capability** — join/leave/mute events delivered to plugins.
- **The `sidebar` slot** — a first-class docked panel region.
- **The frame-level media pipeline** — a host-owned shared WebGL2 worker with a per-frame
  `VideoFrame` budget, for untrusted transforms. First-party transforms use the track-level
  `TrackTransform` today.
- **The untrusted-plugin sandbox** — running third-party plugins in a Web Worker with
  `fetch`/`WebSocket`/etc. removed, a frame budget, and a `network` permission gated by
  explicit user consent. Until this lands, only trust plugins you'd trust as source code.
- **Distribution** — loading a plugin from a URL with a manifest and integrity hash.

Want one of these sooner? Open an issue — the API is meant to grow to fit real plugins, and
the first-party features are the proof it's adequate.
