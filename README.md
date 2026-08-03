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

- **Mesh (today):** small calls connect **peer-to-peer**. This is end-to-end encrypted by
  construction — WebRTC's DTLS-SRTP runs between browsers and no middlebox exists to trust.
- **SFU (built, being wired):** larger calls forward through a **selective forwarding unit**
  (Cloudflare Realtime, or the self-hosted Go SFU), which every client uploads to once. The
  SFU is kept blind by **frame-level encryption** — AES-GCM keyed by an **MLS** group secret
  (OpenMLS, compiled to WASM), applied via insertable streams.

The whole hosted stack targets Cloudflare's **free tier** — there is no purchased server.
Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture, including why an
SFU can't run *inside* a Worker and what that implies.

## Status

Roughly Phases 1–2 of the [roadmap](docs/ROADMAP.md) are **shipped**; Phases 3–6 exist as
**built, compiling foundations** not yet wired into a live call.

- ✅ **Real mesh calls** — camera/mic + device switching, one Durable Object per room over
  WebSocket hibernation, friendly room ids + shareable links, host **lobby** (admit / deny /
  remove / end), **screen share**, **reconnection** (grace window + host reclaim), STUN and
  optional Cloudflare **TURN**.
- ✅ **Plugin system** — a capability-gated host with UI slots + E2EE data topics.
  **Reactions** and **chat** are first-party plugins ([authoring guide](docs/PLUGIN-AUTHORING.md)).
- ✅ **On-device effects** — background **blur** and **image replace** (MediaPipe, bundled,
  no CDN), plus **active-speaker** detection, **pin-to-screen**, an **activity log**,
  keyboard shortcuts, and fullscreen.
- 🏗️ **Scale & sovereignty foundations** — the `Transport` interface, a self-hosted **Go +
  Pion SFU** (`selfhost/`), and **MLS/OpenMLS → WASM** + a frame encryptor (`crypto/`,
  `web/src/core/crypto/`). These compile and run standalone; wiring them into live SFU calls
  is the next phase.

The honest bottom line: **a complete, private, small-group video product today**, with the
scaling and self-hosting machinery built and waiting to be connected.

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

## The optional pieces

- **Self-hosted SFU** — `cd selfhost && go run .` (see [`selfhost/README.md`](selfhost/README.md)).
  A Go + Pion selective-forwarding unit with a bare test client, for anyone who won't trust a
  hosted relay.
- **MLS crypto** — `cd crypto/mls && ./build.sh` rebuilds the WASM module from Rust and
  vendors it into the web app (see [`crypto/README.md`](crypto/README.md)). Only needed if you
  change the Rust.

## Repository

```
samvad/
├── web/               # React + TypeScript + Vite frontend  → Cloudflare Pages
│   └── src/
│       ├── core/      # transport, media, rooms, plugin host, crypto — the load-bearing parts
│       ├── features/  # the room UI (stage, controls, panels, pre-join, home)
│       ├── plugins/   # first-party plugins: reactions, chat
│       └── design/    # design tokens, primitives, icons
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
