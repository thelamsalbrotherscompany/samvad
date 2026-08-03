# Writing a Samvad Plugin

This is the practical, **build-one-today** guide. It documents the plugin API *as it is
actually implemented right now*. For the full design vision — the untrusted-plugin Worker
sandbox, the `network` permission model, media-transform plugins, and URL-based
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
| `ui` → `sidebar` / `settings` | ⛔ | slot names exist; not mounted yet (use `toolbar` + your own panel) |
| `lifecycle` | ⛔ | declared in the types; not yet delivered to plugins |
| `video-transform` / `audio-transform` | ⛔ | the media-pipeline hook isn't wired yet |
| `storage` / `network` | ⛔ | not implemented (and `network` will require user consent) |
| Worker sandbox / integrity / URL loading | ⛔ | first-party, in-process only for now |

Plugins currently run **in-process** and are **registered in code** (an array in the app),
not loaded from a URL. That's enough to build and ship first-party features through the
same API third parties will eventually use.

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
import wavePlugin from '@/plugins/wave' // ← your plugin

const PLUGINS = [reactionsPlugin, chatPlugin, wavePlugin]
```

That's the whole loop: drop a folder in `web/src/plugins/`, add one import + array entry,
and it's live in the next call. `setup` runs when a call starts and `teardown` when it ends.

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

## Learn from the built-ins

Both are small, complete, and use nothing but the public API:

- **`web/src/plugins/reactions/`** — a `data` topic + `toolbar` + `tile-overlay`. Shows
  per-participant tile overlays and keying local state to `selfId` / sender id.
- **`web/src/plugins/chat/`** — a `data` topic + `toolbar`. Shows a plugin that owns its own
  button, unread badge, and panel entirely within the `toolbar` slot — proof you don't need
  a dedicated panel slot to build a rich panel.

---

## Not available yet (planned — see `PLUGINS.md`)

- **Media-transform plugins** (`video-transform` / `audio-transform`) — the background-blur
  path. Needs the frame-pipeline hook and a shared WebGL2 worker context.
- **The `lifecycle` capability** — join/leave/mute events delivered to plugins.
- **`sidebar` / `settings` slots** — first-class panels and a settings section.
- **The untrusted-plugin sandbox** — running third-party plugins in a Web Worker with
  `fetch`/`WebSocket`/etc. removed, a frame budget, and a `network` permission gated by
  explicit user consent. Until this lands, only trust plugins you'd trust as source code.
- **Distribution** — loading a plugin from a URL with a manifest and integrity hash.

Want one of these sooner? Open an issue — the API is meant to grow to fit real plugins, and
the first-party features are the proof it's adequate.
