<div align="center">

# Samvad · संवाद

**Private, open-source video calls. No accounts. No database. Nothing stored.**

*संवाद means dialogue — not "meeting". The software's job is to get out of the way, and to forget.*

</div>

---

## What it is

Samvad is a video-conferencing app — think Google Meet or Zoom — rebuilt around a single
idea: **the server forgets.** There is no database. Room state lives in memory and dies the
moment the last person leaves. Calls are end-to-end encrypted, so no server in the path can
see or hear them. It is meant to be genuinely self-hostable, and it is contributor-first:
features like background blur, chat, and reactions are **plugins**, not core.

It is not a Meet or Zoom clone. It makes a smaller set of promises and actually keeps them.

## Why it's different

| | Samvad |
|---|---|
| **Accounts** | None. Knowing the link is the credential |
| **Database** | None. State is in RAM, gone when the room empties |
| **Encryption** | End-to-end. Small calls are P2P (no middlebox); the SFU path is kept blind by frame-level encryption |
| **Telemetry** | None. No analytics, no CDN, no runtime network calls the user didn't ask for |
| **Self-hosting** | A first-class path (a Go + Pion SFU ships in `selfhost/`) — the honest answer to "why trust you?" |
| **Extending it** | A capability-based plugin API. Contributors add modules without touching core |

We are also **honest about the limits.** End-to-end encryption hides *content*, never
*metadata* — while a call is live, any server in the path still sees IP addresses, room IDs,
and timing. No SFU-based product can truthfully claim otherwise, and we don't. See
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## How it works

A static React SPA talks to a **signalling Worker with one Durable Object per room**, which
holds membership in memory — no storage of any kind. From there, media takes one of two
paths behind a single [`Transport`](web/src/core/transport/Transport.ts) interface, so the
UI never knows or cares which is active:

- **Mesh (default):** small calls connect **peer-to-peer**. This is end-to-end encrypted by
  construction — WebRTC's DTLS-SRTP runs between browsers and no middlebox exists to trust.
- **SFU (self-hosted path wired):** larger calls forward through a **selective forwarding
  unit** — every client uploads once. The self-hosted **Go + Pion SFU** (`selfhost/`) is wired
  into the app today (opt in with `?sfu=1`) and kept blind by **frame-level encryption**:
  AES-GCM keyed by an **MLS** group secret (OpenMLS → WASM), applied via insertable streams, so
  it forwards ciphertext it can't read. The hosted **Cloudflare Realtime** path reuses the
  identical crypto and is next.

The whole hosted stack targets Cloudflare's **free tier** — there is no purchased server.
Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture, including why an
SFU can't run *inside* a Worker and what that implies.

## Status

Phases 1–2 of the [roadmap](docs/ROADMAP.md) are **shipped**, and the **self-hosted SFU path
is wired end-to-end, including its E2EE**. The remaining big piece is the hosted **Cloudflare
Realtime** transport (Phase 3), which needs a deploy.

- ✅ **Real mesh calls** — camera/mic + device switching, one Durable Object per room over
  WebSocket hibernation, friendly room ids + shareable links, host **lobby** (admit / deny /
  remove / end), **screen share**, **reconnection** (grace window + host reclaim), STUN and
  optional Cloudflare **TURN**.
- ✅ **Plugin system** — a capability-gated host with UI slots, E2EE data topics, and
  `video`/`audio-transform` capabilities. **Reactions, chat, background effects, and a noise
  gate** are all first-party plugins on the public API ([authoring guide](docs/PLUGIN-AUTHORING.md)).
- ✅ **On-device effects** — background **blur / image replace / bundled gradients**
  (MediaPipe, segmentation in a **Web Worker**, no CDN) and a **noise gate**, both plugins;
  plus **active-speaker** detection, **pin-to-screen**, an **activity log**, keyboard
  shortcuts, and fullscreen.
- ✅ **Self-hosted SFU + E2EE over it** — `PionTransport` routes media through the **Go + Pion
  SFU** while reusing the signalling DO for presence, and the **MLS/OpenMLS→WASM** coordinator
  + frame encryptor make the SFU **blind to the media** (indicator reports `sfu-e2ee` once
  keyed). The encryption is **verified** — unit tests, native MLS tests, a Go SFU test, and a
  headless-Chromium test that proves frames actually encrypt/decrypt over live WebRTC (see
  [Testing](#testing)).
- ⏳ **Cloudflare Realtime transport** — the hosted at-scale path; reuses the same crypto,
  needs a deploy to wire.

The honest bottom line: **a complete, private, small-group video product today**, plus a
**self-hostable, end-to-end-encrypted SFU path** you can run and verify yourself with no
Cloudflare account.

## Quick start

**Prerequisite:** [Bun](https://bun.sh). Optional, only for the extra pieces: **the latest
Go** (self-hosted SFU) and **Rust + wasm-bindgen** (rebuilding the MLS crypto — the built
module is committed, so you don't need this for normal work).

Run the two dev servers in two terminals:

```bash
# 1) signalling worker  (Cloudflare Worker + Durable Object)
cd worker && bun install && bun run dev      # → http://localhost:8787

# 2) web app  (Vite proxies /ws and /ice to the worker)
cd web && bun install && bun run dev         # → http://localhost:5173
```

**Try a real call:** open <http://localhost:5173> in **two tabs**. In the first, click
**New meeting** and join; copy the room link into the second tab and join; back in the first
tab, **admit** them from the lobby. You're on a peer-to-peer, end-to-end-encrypted call.

> 🎧 On one machine, use **headphones** (or mute one tab's speaker) — otherwise the two tabs
> feed each other's audio and howl. That's acoustic feedback, not a bug.

**Production build** (strict type-check + bundle): `cd web && bun run build`.

## Testing

The privacy-critical parts are covered by tests you can run yourself:

```bash
cd web && bun run test        # unit: frame cipher + MLS coordinator (loads the real OpenMLS WASM)
cd web && bun run test:e2e    # headless Chromium: E2EE over live WebRTC (needs: npx playwright install chromium)
cd selfhost && go test ./...  # SFU signalling contract
cd crypto/mls && cargo test   # MLS group agreement + key rotation (native)
```

The browser test ([`web/e2e/`](web/e2e/README.md)) is the interesting one: it runs the real
frame cipher over two live `RTCPeerConnection`s and asserts the correct key decrypts the video
while a **wrong key can't** — proof the media is genuinely encrypted, not passed through. Run
it whenever you change `web/src/core/crypto/` or the transport's E2EE wiring.

## The optional pieces

- **Self-hosted SFU** — `cd selfhost && go run .` (see [`selfhost/README.md`](selfhost/README.md)).
  A Go + Pion selective-forwarding unit. To use it from the real app, run the worker + SFU +
  web together and open the app with **`?sfu=1`** — media then flows through the SFU, E2EE, with
  the full UI. Steps are in [`selfhost/README.md`](selfhost/README.md).
- **MLS crypto** — `cd crypto/mls && ./build.sh` rebuilds the WASM module from Rust and
  vendors it into the web app (see [`crypto/README.md`](crypto/README.md)). Only needed if you
  change the Rust.

## Repository

```
samvad/
├── web/               # React + TypeScript + Vite frontend  → Cloudflare Pages
│   ├── src/
│   │   ├── core/      # transport (mesh + Pion SFU), media, rooms, plugin host, crypto
│   │   ├── features/  # the room UI (stage, controls, panels, pre-join, home)
│   │   ├── plugins/   # first-party plugins: reactions, chat, background, noise
│   │   └── design/    # design tokens, primitives, icons
│   └── e2e/           # headless-browser E2EE test (Playwright)
├── worker/            # Cloudflare Worker + one Durable Object per room (signalling, /ice)
├── selfhost/          # Go + Pion self-hosted SFU (sovereignty exit)
├── crypto/            # MLS via OpenMLS, Rust → WASM (E2EE key agreement)
└── docs/              # architecture, roadmap, plugins, threat model, design
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, the no-database model, the stack, and the SFU question
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — build order and what each phase delivers (with ✅ status)
- [`docs/PLUGINS.md`](docs/PLUGINS.md) — the plugin contract and the capability sandbox (the design)
- [`docs/PLUGIN-AUTHORING.md`](docs/PLUGIN-AUTHORING.md) — **build & register a plugin today** (a complete example)
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — what Samvad protects against, and what it deliberately does not
- [`docs/DESIGN.md`](docs/DESIGN.md) — visual and interaction direction
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to set up, the conventions, and the non-negotiables
- Component readmes: [`selfhost/`](selfhost/README.md), [`crypto/`](crypto/README.md), [`web/src/plugins/`](web/src/plugins/README.md)

## Contributing

The plugin API is how Samvad is meant to grow — start with
[`docs/PLUGIN-AUTHORING.md`](docs/PLUGIN-AUTHORING.md). If a feature you want can't be built
through the public plugin API, that's a bug in the API; open an issue. First-party features
are held to the same rule: they use only the public API, no privileged access to core. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and conventions.

## License

[AGPL-3.0](LICENSE) © Sangam Lamsal. Copyleft by design: if you run a modified Samvad as a
network service, you must offer your users its source. Self-hosting and forking are
encouraged — quietly closing it up is not.

---

<div align="center">
<sub>Built by Sangam Lamsal. A network request you didn't ask for is a bug.</sub>
</div>
