# Samvad — Project Guide

Privacy-focused, open-source video conferencing. **संवाद** — *dialogue*.
Author: Sangam Lamsal.

## Read first

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, no-database model, stack
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — build order, what ships when
- [`docs/PLUGINS.md`](docs/PLUGINS.md) — plugin contract and capability sandbox (the design)
- [`docs/PLUGIN-AUTHORING.md`](docs/PLUGIN-AUTHORING.md) — how to build & register a plugin today
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — guarantees and their limits
- [`docs/DESIGN.md`](docs/DESIGN.md) — visual and interaction direction

## Non-negotiables

These are decisions, not preferences. Changing one means updating the docs above in the
same change.

1. **No database.** State lives in RAM and dies with the room. If a feature seems to need
   persistence, find the stateless design instead — deterministic IDs, signed tokens,
   client-side storage.
2. **No telemetry, no analytics, no runtime CDN fetches.** Fonts, icons, and models ship
   with the build. A network request the user didn't ask for is a bug.
3. **No SFU may ever transcode or decrypt.** It forwards RTP and rewrites headers, nothing
   more. This is what makes E2EE possible at all.
4. **No media service that can read media** (Agora, Twilio, Daily, Zoom SDK). Cloudflare
   Realtime is acceptable *only* because insertable-streams E2EE makes it blind, and only
   while `PionTransport` keeps a real exit available. Compiled-in libraries are fine —
   React, Radix, OpenMLS, Pion are ingredients, not products. See ARCHITECTURE §7.
5. **No custom cryptographic primitives.** Standard, audited algorithms only.
6. **Never overstate privacy.** The encryption indicator reports the real mode. Metadata
   exposure is documented, not hidden.
7. **First-party plugins use only the public plugin API.** No privileged imports from
   `core/`. If a feature can't be built through the public API, fix the API.

## Deployment constraint

Samvad deploys to **Cloudflare Pages + Workers on the free tier. There is no purchased
server.** This is a hard constraint. Notably, Workers cannot bind UDP sockets, so Samvad
**cannot run its own SFU** — see ARCHITECTURE §4 before proposing anything media-server
shaped.

## Stack

- **Frontend:** React + TypeScript + Vite → Cloudflare Pages. SPA — no SSR.
- **Signalling + rooms:** TypeScript Worker + **one Durable Object per room**, state in
  memory only. Use the WebSocket Hibernation API — it's what keeps the free tier viable.
- **Media:** pluggable `Transport` — `MeshTransport` (P2P) → `RealtimeTransport`
  (Cloudflare Realtime SFU) → `PionTransport` (self-hosted Go, Phase 6+).
- **E2EE:** Insertable Streams + MLS via OpenMLS (Rust → WASM).
- **Styling:** Tailwind over custom design tokens. Radix for headless a11y primitives.
- **State:** Zustand.
- **Effects:** WebGL2 + WASM in a Web Worker.
- **Storage:** none. No D1, no KV, no R2, no DO storage API.

Go is **not** needed for v1; it returns only for the optional self-hosted SFU.

## Conventions

- Go: standard layout, `internal/` for non-public packages. Errors wrapped with context,
  never swallowed.
- TypeScript: `strict: true`. No `any` — use `unknown` and narrow.
- The `Transport` interface is load-bearing. UI code must never branch on which transport
  is active; if it needs to, the abstraction is leaking and that's the bug to fix. This
  interface is also what stops Cloudflare becoming a lock-in.
- Go: standard layout, `internal/` for non-public packages — applies to `selfhost/` only.
- Design tokens are the single source of truth for color, type, spacing, motion. No
  hardcoded hex values in components.
- `prefers-reduced-motion` collapses all animation to 0ms. Always.

## Current status

Phases 1–2 shipped (real mesh calls; effects/chat/reactions are all first-party plugins on
the public API; background segmentation runs in a Web Worker). The **self-hosted SFU path is
wired end-to-end**: `PionTransport` (opt in with `?sfu=1`) routes media through the Go + Pion
SFU in `selfhost/` while reusing the signalling DO for presence, and **E2EE is live on it** —
the built MLS/OpenMLS→WASM coordinator + frame encryptor attach over a DO data relay, so the
SFU forwards ciphertext (indicator shows `sfu-e2ee` once keyed, honest `hop-by-hop` otherwise).
Still open: the Cloudflare `RealtimeTransport` (Phase 3, needs deploy), plugin data + screen
over the SFU, and the untrusted-plugin Worker sandbox. `docs/ROADMAP.md` is the source of truth
— read it before assuming something is or isn't built. The self-hosted E2EE path needs the
3-process local run (Chromium) to confirm end-to-end; see `selfhost/README.md`.
