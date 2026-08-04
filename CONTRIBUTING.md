# Contributing to Samvad

Thanks for wanting to help. This is a privacy tool, so it holds a few lines harder than most
projects — read the **non-negotiables** below before a big change. The fastest, most welcome
contribution is a **plugin** (see [`docs/PLUGIN-AUTHORING.md`](docs/PLUGIN-AUTHORING.md));
most features belong there, not in core.

## Setup

**Prerequisite:** [Bun](https://bun.sh). Optional, per component: **the latest Go**
(self-hosted SFU) and **Rust + `wasm-bindgen`** (the MLS crypto — the built module is
committed, so you only need this if you change the Rust).

Two dev servers, two terminals:

```bash
cd worker && bun install && bun run dev   # signalling: Cloudflare Worker + Durable Object → :8787
cd web    && bun install && bun run dev   # app: Vite (proxies /ws and /ice to the worker) → :5173
```

Then open <http://localhost:5173> in two tabs to exercise a real call (New meeting → join →
admit). On one machine, wear headphones or mute one tab — otherwise the tabs howl (acoustic
feedback, not a bug).

## The components, and how to check each

| Component | Dir | Build / check | Test |
|---|---|---|---|
| Web app | `web/` | `bun run build` (strict `tsc` + Vite), `bun run lint` (oxlint) | `bun run test` (unit), `bun run test:e2e` (browser) |
| Signalling worker | `worker/` | `bun run typecheck`, `bun run dev` | — |
| Self-hosted SFU | `selfhost/` | `go build ./...`, `go vet ./...`, `go run .` | `go test ./...` |
| MLS crypto (WASM) | `crypto/mls/` | `./build.sh` (rebuilds wasm + vendors it into `web/`) | `cargo test` |

**Always** run `bun run build` **and** `bun run lint` in `web/` before you push — the build
is the type-check, and both must be clean. Go changes must `go build` and `go vet` clean.

## Testing

The privacy-critical parts have tests; run the ones your change touches.

- **`web/` unit** (`bun run test`) — the frame cipher (`frameCrypto.test.ts`, real WebCrypto
  round-trips) and the MLS coordinator (`E2eeSession.test.ts`, which loads the real OpenMLS
  WASM and proves two parties agree on a key and that removal rotates it).
- **`web/` browser** (`bun run test:e2e`, needs `npx playwright install chromium`) — the one
  thing unit tests can't reach: it drives real Chromium and proves the frame cipher actually
  encrypts/decrypts over **live WebRTC** (Insertable Streams), with a wrong key unable to
  decode. See [`web/e2e/README.md`](web/e2e/README.md).
- **`selfhost/`** (`go test ./...`) — the SFU's server-sole-offer signalling contract.
- **`crypto/mls/`** (`cargo test`) — MLS group agreement and key rotation, natively.

**If you touch `web/src/core/crypto/` or the transport's E2EE wiring, run `bun run test:e2e`.**
A green unit suite doesn't prove the browser pipeline still round-trips; that test does.

To exercise the **self-hosted SFU path** end-to-end, run three processes — worker + SFU + web
— and open the app with **`?sfu=1`** (steps in [`selfhost/README.md`](selfhost/README.md)).
Media then flows through the SFU with the full UI, E2EE, and the badge reads *End-to-end
encrypted* once the group keys.

## Where things live

- `web/src/core/` — the load-bearing parts: **transport** (mesh + `PionTransport` behind the
  `Transport` interface), **media** capture + the media-plugin host, **rooms**, the **plugin
  host**, **crypto** (MLS coordinator + frame cipher). UI code depends on these; they don't
  depend on UI.
- `web/src/features/` — the room UI: stage/layout, control bar, panels, pre-join, home.
- `web/src/plugins/` — first-party plugins (reactions, chat, background effects, noise gate),
  each on the public API only. New user-facing features usually go here.
- `web/e2e/` — the headless-browser E2EE test (Playwright).
- `web/src/design/` — design tokens, primitives, icons. Colors/spacing/motion come from here.
- `worker/`, `selfhost/`, `crypto/` — signalling, the self-hosted SFU, and E2EE key agreement.

## Non-negotiables

These are decisions, not preferences. Changing one means updating the docs in the same PR,
and probably a discussion first.

1. **No database.** State lives in RAM and dies with the room. Need persistence? Find the
   stateless design (deterministic ids, signed tokens, client-side storage).
2. **No telemetry, no analytics, no runtime CDN fetches.** Fonts, icons, and models ship with
   the build. A network request the user didn't ask for is a bug.
3. **No SFU may transcode or decrypt.** It forwards RTP and rewrites headers, nothing more.
4. **No media service that can read media** (Agora, Twilio, Daily, Zoom SDK). Cloudflare
   Realtime is acceptable *only* because insertable-streams E2EE makes it blind, and only
   while a self-hosted exit exists. Compiled-in libraries (React, Radix, OpenMLS, Pion) are
   ingredients, not products.
5. **No custom cryptographic primitives.** Standard, audited algorithms only (OpenMLS,
   WebCrypto).
6. **Never overstate privacy.** The encryption indicator reports the *real* mode, never an
   aspiration. Metadata exposure is documented, not hidden.
7. **First-party plugins use only the public plugin API.** No privileged imports from `core/`.
   If a feature can't be built through the public API, fix the API — don't grant a back door.

There's also a hard **deployment constraint**: the hosted stack runs on **Cloudflare Pages +
Workers, free tier, no purchased server**. Notably, Workers can't bind UDP sockets, so Samvad
**cannot run its own SFU inside a Worker** — see `docs/ARCHITECTURE.md` before proposing
anything media-server-shaped.

## Conventions

- **TypeScript:** `strict: true`. No `any` — use `unknown` and narrow. `erasableSyntaxOnly`
  is on (no parameter properties, no enums).
- **The `Transport` interface is load-bearing.** UI code must never branch on which transport
  is active. If it needs to, the abstraction is leaking — that's the bug to fix. This is also
  what stops Cloudflare from becoming a lock-in.
- **Design tokens are the single source of truth** for color, type, spacing, motion. No
  hardcoded hex in components. `prefers-reduced-motion` collapses all animation to 0ms —
  always.
- **Go:** standard layout, `internal/` for non-public packages (applies to `selfhost/`).
  Errors wrapped with context, never swallowed.
- **Design from first principles**, not by copying Meet/Zoom — except where a convention is
  genuinely load-bearing (e.g. a mirrored self-view). See `docs/DESIGN.md`.

## Commits & pull requests

- Keep commits focused; write a message that says *why*, not just *what*.
- Don't commit build output. `node_modules/`, `dist/`, Rust `target/`, and the generated
  wasm `pkg/` are git-ignored — keep it that way. (Built artifacts we *do* vendor, like the
  MLS wasm, are checked in deliberately and rebuilt via a script.)
- A PR should build and lint clean (see the table above) and update any docs a change makes
  stale.

## License

By contributing, you agree your contributions are licensed under the project's
[AGPL-3.0](LICENSE).
