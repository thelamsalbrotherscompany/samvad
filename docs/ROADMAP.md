# Samvad — Roadmap

Ordered to keep something **demonstrable and shippable at every phase**. The SFU is the
hardest part and it is deliberately *not* first — Phase 1 delivers a real, working
video call while the SFU is still unwritten.

---

## Phase 0 — Shell and design system ✅

*No media. Prove the product feels right before making it work.*

- ✅ Design tokens: color, type scale, spacing, motion, elevation
- ✅ Core primitives: Button, Toggle, Tooltip, Dialog, Popover, Avatar, Tile
- ✅ Screens: landing, pre-join (device check, mic meter, camera preview), in-room, post-call
- ✅ Stage layout engine — grid, spotlight, sidebar; smooth reflow (validated with temporary
  fake participants, since removed once real calls landed)
- ✅ Frontend served as a **static SPA** (Vite → Cloudflare Pages) — the early "Go binary
  serving the embedded build" idea was dropped; the app is static, the Worker does signalling

**Was done when:** a 12-person meeting was navigable and genuinely looked designed.
Superseded by Phase 1's real calls.

---

## Phase 1 — Real calls, mesh only

*Ship a working product.*

- ✅ Camera/mic capture, device switching, mute both directions, live level, graceful
  no-/partial-device fallback (`web/src/core/media/`)
- ✅ Worker + `RoomDO` Durable Object: WebSocket signalling, in-memory membership,
  Hibernation API from the start (`worker/`)
- ✅ `Transport` interface + `MeshTransport` — client peer connections over the signalling
  DO, with per-peer audio/video and echo cancellation (`web/src/core/transport/`)
- ✅ Rooms: friendly slug ids, hash-based routing, home/create/join, real shareable links
  (`web/src/core/room/`). Passphrase-derived deterministic ids (Argon2id → BLAKE2b, tied
  to the E2EE key) come with encryption
- ✅ `stun.cloudflare.com` + Cloudflare Realtime **TURN**, for the ~15% of networks that
  can't connect directly. The worker serves `/ice`; with `TURN_KEY_ID` + `TURN_API_TOKEN`
  secrets set, it mints short-lived TURN credentials server-side (the API token never
  reaches the browser) and returns STUN + TURN, else STUN only. TURN relays *encrypted*
  RTP — it's a blind forwarder, not a media service, so it stays inside the
  non-negotiables (`worker/src/ice.ts`)
- ✅ Screen share (real capture): `getDisplayMedia` on a **dedicated PC per viewer**, so it
  never renegotiates the camera/mic link — the presenter offers, viewers answer, no glare.
  A `sharing` presence flag drives teardown; the shared screen takes the featured stage. The
  camera path is untouched (`web/src/core/transport/MeshTransport.ts`). Captured audio
  routing is deferred
- ✅ Reconnect on network drop: per-tab session id + a ~30s in-RAM grace window in the
  `RoomDO` — a drop/refresh reclaims the same spot (and host role) without re-knocking; a
  deliberate leave gets no grace. Client auto-reconnects with backoff. Best-effort by
  design: the grace lives in DO memory, so a solo-host refresh instead recreates the room
  from a persisted create-intent (`worker/src/room.ts`, `web/src/core/transport/`)

**Done when:** four people on four networks hold a real conversation.
Mesh is genuinely E2EE — there is no middlebox to trust.

**This is the first public release.** Small-group, private, self-hostable. Complete and
useful on its own terms, even with everything below unbuilt.

---

## Phase 2 — Plugin system and effects

*The differentiator, and it lands before the SFU on purpose — it works fine over mesh.*

- ✅ **Plugin host** (`web/src/core/plugins/`): the public contract from docs/PLUGINS.md §1
  (`SamvadPlugin`, capability manifest, `PluginContext`), a **capability-gated context**
  (a method/slot a plugin didn't declare isn't attached, or throws), **UI slots**
  (toolbar, tile-overlay, stage-overlay, **settings**), **E2EE data topics** (namespaced per
  plugin, over the same P2P channel as media), and **`video-transform` / `audio-transform`**
  via a **media-plugin host** (`web/src/core/media/mediaPlugins.ts`) that runs from pre-join.
  plus gated **`storage`** (`ctx.storage`, namespaced + tab-lifetime) and **`network`**
  (`ctx.net.fetch`, origin-restricted) sub-APIs. ⚠️ First-party, **in-process** for now, so
  `storage`/`network` gating is a *convention and portability shim, not a hard boundary* — a
  plugin still has ambient `fetch`/`localStorage`. Real isolation (the Worker realm that
  strips those globals, manifest integrity hashes, and URL loading) is **Phase 6**
- ✅ **Media pipeline**: a generic video-transform pipeline in core applies whatever
  `TrackTransform` a plugin registers (raw track when none), and MediaPipe **segmentation runs
  in a Web Worker** (`plugins/background/segmenter.worker.ts`) — inference and the O(pixels)
  mask loop leave the main thread; the worker posts back an alpha-mask bitmap and the main
  thread composites. Output stays a plain `canvas.captureStream()` (no
  `MediaStreamTrackGenerator`), so it's cross-browser and never emits a black frame; it falls
  back to main-thread segmentation if the worker can't run. ⏳ *Still open:* a **shared WebGL2
  compositor** (compositing is Canvas2D today) — a real optimisation that wants on-device
  profiling to tune
- ⏳ **Frame budget**: the segmentation worker self-throttles (one frame in flight), so the
  effect *adapts* under load rather than stalling. A host-level **auto-disable on repeated
  overrun** is deliberately scoped to the **untrusted-plugin sandbox** (Phase 6): auto-off is
  wrong for a *privacy* effect — disabling blur would expose the user's real background — so a
  first-party effect must degrade, never disable
- Reference plugins: **background blur**, **background replace**, noise suppression
  - ✅ **Background blur / replace** shipped as a **first-party plugin**
    (`web/src/plugins/background/`), built on the public API only (non-negotiable #7): MediaPipe
    Selfie Segmenter (WASM + model **vendored in `public/mediapipe/`, no CDN**, lazy-loaded only
    when enabled) segments the person; the background is blurred, or replaced with a
    **user-picked image** (read to a data URL, kept **in memory on-device only** — never
    uploaded, never persisted), and composited back into the published stream — so **peers see
    it too**, not just the local view. The plugin owns its own settings picker (the `settings`
    slot) and registers its transform only while an effect is on. Graceful fallback to the raw
    camera when unsupported. ✅ Ships **bundled stock backdrops** (`plugins/background/stock.ts`)
    — gradient SVGs generated in code (no CDN, sharp at any size) that flow through the same
    image path, alongside upload-your-own
  - ✅ **Noise gate** (`web/src/plugins/noise/`): a first-party **`audio-transform`** plugin —
    the dogfood proof that audio transforms work. High-pass (85 Hz, strips rumble) → an
    analyser-driven gain that attenuates the mic on silence with fast-attack / gentle-release
    hysteresis, from standard Web Audio nodes (no AudioWorklet). Opt-in (off by default), a
    complement to the browser's built-in suppression, not a replacement
- ✅ UI slots and data-channel topics (part of the plugin host above)
- ✅ **Reactions and chat rebuilt as first-party plugins** (`web/src/plugins/reactions/`,
  `web/src/plugins/chat/`) — the dogfood test of the API (docs/PLUGINS.md §8). Each imports
  **only** the public plugin API (plus the design system), no core internals. Reactions uses
  a data topic + toolbar + tile-overlay slots; chat uses a data topic + the toolbar slot and
  owns its own button, unread badge, and panel — needing *no* sidebar-slot machinery in core,
  which is itself evidence the minimal API generalises. Both behave identically to before
- ✅ **Chat** shipped (`web/src/features/room/ChatPanel.tsx`): text rides the **WebRTC data
    channels** (one negotiated channel per peer), so it's **E2EE and never touches the
    signalling server** — no middlebox can read it. Ephemeral (no history; late joiners see
    only new messages), with an unread badge on the Chat control. ⚠️ Built in core for now;
    to be **rebuilt as a plugin** once the plugin host lands, to prove the API is real
- ✅ **Emoji reactions** (`ReactionsOverlay` + picker in the control bar): sent over the same
    P2P data channel (tagged `chat` | `reaction`), float up and fade, auto-expire — nothing
    stored. Respects `prefers-reduced-motion`. Same "rebuild as a plugin later" note as chat
- Chat + reactions rebuilt *as plugins*, to prove the API is real

**Done when:** a contributor writes a working effect plugin using only public docs, and
it cannot reach the network.

---

## Phase 3 — Scale past mesh, via Cloudflare Realtime SFU

*Much smaller than it would have been. Workers can't run an SFU (no UDP sockets), so this
is an integration, not a media server. Weeks, not months — see ARCHITECTURE §4.*

- `RealtimeTransport` behind the existing interface
- Automatic mesh→SFU promotion at the 5th join, invisible to users
- Simulcast: publish 3 layers, select per receiver
- ✅ Active-speaker detection via audio energy — done early at the mesh level
  (`web/src/core/media/useActiveSpeaker.ts`): WebAudio RMS per source drives the speaking
  rings and a *sticky* dominant-remote pick for the featured tile (holds through pauses,
  switches only on a clear margin). Client-side and transport-agnostic, so it carries into
  the SFU unchanged
- Subscribe-to-visible: off-screen tiles cost nothing
- Egress budgeting and a visible usage indicator — the free tier is 1,000 GB

**Done when:** 30 participants hold a stable call and the UI code is unchanged from
Phase 1 — that unchanged UI is the proof the abstraction was correct.

---

## Phase 4 — End-to-end encryption over the SFU

- ✅ **MLS (RFC 9420) via OpenMLS, Rust → WASM** (`crypto/mls/`): a thin wrapper around
  audited OpenMLS 0.8 (MIT), compiled to `wasm32` — full group API (create / add → commit
  + welcome / join / process / remove / export epoch secret). Forward secrecy + post-
  compromise security + cryptographic membership. Built module vendored to
  `web/src/core/crypto/mls/`; loads on demand. Samvad writes no crypto of its own
- ✅ **Insertable-Streams frame encryption** (`web/src/core/crypto/frameCrypto.ts`): per-frame
  AES-GCM keyed by the MLS epoch secret (HKDF), epoch-tagged for in-flight **key rotation**,
  installs via `RTCRtpScriptTransform`/`createEncodedStreams`. ⚠️ Leaves the codec header
  bytes clear (10 key / 3 delta video, 1 audio) so browsers still depacketize
- ✅ **MLS group flow verified** by native tests (`crypto/mls/tests/`): two/three parties
  derive the *same* frame secret, and removing a member rotates the key + advances the epoch
- ✅ **E2EE coordinator** (`web/src/core/crypto/E2eeSession.ts`): host-as-sole-committer group
  management — publishes key packages, adds admitted peers (commit broadcast + welcome
  unicast), rotates on leave, and keeps the frame cipher keyed to the current epoch — all over
  the existing E2EE data channel
- ⏳ Wiring it live: run the coordinator on the **SFU path**, sync MLS membership to the lobby,
  and handle **host handoff** (transfer the committer role). The mesh is already E2EE, so this
  only needs to switch on once media flows through a relay
- Honest, always-visible encryption indicator: mesh-E2EE / SFU-E2EE / hop-by-hop
- Documented, tested fallback for browsers lacking Insertable Streams

**Done when:** packet capture at the SFU yields no intelligible media, and the SFU's own
logs demonstrably cannot reconstruct a frame.

---

## Phase 5 — Classroom scale

- Classroom mode: one presenter publishes video; participants are audio-first
- Hand-raise, speaking queue, presenter handoff
- Moderation: mute-all, remove, lock room, waiting room
- Pagination for large grids
- Adaptive quality on constrained downlinks

**Done when:** a 40-person class runs for an hour without intervention.

---

## Phase 6 — Trust, sovereignty, and polish

- **`PionTransport`** — a self-hosted Go + Pion SFU in `selfhost/`, for anyone who declines
  to trust Cloudflare. This is what keeps the project from being vendor-captured, and it's
  the honest answer to THREAT-MODEL §4
  - ✅ **SFU server built** (`selfhost/`, Go + Pion): per-room track fan-out (publish once,
    forward to all), server-sole-offer signalling (no glare), keyframe requests, clean
    teardown. Compiles, `go vet`s, boots and serves; a bare test client (`web/index.html`)
    verifies it in two browser tabs. Forwards RTP only — never transcodes, and blind to
    E2EE media. ⏳ Still to do: the browser `PionTransport` (client `Transport` impl reusing
    the app's lobby/presence signalling), screen-share as a 2nd track, and simulcast
- Published threat model, reviewed by someone who wasn't you
- Reproducible builds; signed release binaries
- `docs/SELF-HOSTING.md` — the one-binary path, and a TLS/reverse-proxy path
- Accessibility pass: keyboard-complete, screen-reader-labelled, WCAG AA contrast
- i18n, with नेपाली and हिन्दी as first-class rather than afterthoughts
- Plugin authoring guide + template repository

---

## Explicitly out of scope for v1

Written down so they don't creep in:

- ❌ Mobile native apps (mobile browsers work; native comes much later if ever)
- ❌ Server-side recording (client-side only)
- ❌ SIP / phone dial-in (breaks E2EE by definition)
- ❌ Cloud transcription (on-device Whisper WASM is the eventual answer)
- ❌ User accounts, orgs, billing
- ❌ SFU cascading / multi-region
- ❌ Webinar mode, 100+ participants
- ❌ Virtual backgrounds beyond blur + static image

---

## Sequencing risks

| Risk | Mitigation |
|---|---|
| SFU takes far longer than hoped | Phase 1 already shipped; the project is alive regardless |
| Cloudflare free tier exhausted by classroom use | ~25 hrs/month of 30-person calls, then $0.05/GB. Surface usage in-app before it surprises you |
| Cloudflare changes terms or pricing | `PionTransport` (Phase 6) is the exit. Keep the `Transport` interface clean so it stays a real option, not a theoretical one |
| E2EE + simulcast interact badly | Prototype the interaction during Phase 3, not after |
| Plugin API proves inadequate | First-party features use only the public API — the gap surfaces early |
| Effects tank performance on low-end devices | Frame budget enforced from the first plugin, not retrofitted |
| Scope creep from "just one more feature" | The out-of-scope list above is a contract, not a suggestion |
