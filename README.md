<div align="center">

# Samvad · संवाद

**Private, open-source video calls. No accounts. No database. Nothing stored.**

*संवाद means dialogue — not "meeting". The software's job is to get out of the way, and to forget.*

</div>

---

## What it is

Samvad is a video-conferencing app — think Google Meet or Zoom — rebuilt around a single
idea: **the server forgets.** There is no database. Room state lives in memory and dies
the moment the last person leaves. Calls are end-to-end encrypted, so no server in the
path can see or hear them. It is meant to be genuinely self-hostable, and it is
contributor-first: features like background blur are **plugins**, not core.

It is not a Meet or Zoom clone. It makes a smaller set of promises and actually keeps them.

## Why it's different

| | Samvad |
|---|---|
| **Accounts** | None. Knowing the link is the credential |
| **Database** | None. State is in RAM, gone when the room empties |
| **Encryption** | End-to-end. The relay forwards frames it cannot decrypt |
| **Telemetry** | None. No analytics, no CDN, no runtime network calls the user didn't ask for |
| **Self-hosting** | A first-class path, not an afterthought — it's the honest answer to "why trust you?" |
| **Extending it** | A capability-sandboxed plugin API. Contributors add modules without touching core |

We are also **honest about the limits.** End-to-end encryption hides *content*, never
*metadata* — while a call is live, any server in the path still sees IP addresses, room
IDs, and timing. No SFU-based product can truthfully claim otherwise, and we don't. See
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## How it works, in one paragraph

The app is a static React SPA on **Cloudflare Pages**. Room coordination is a **Cloudflare
Worker with one Durable Object per room**, holding membership in memory — no storage of any
kind. Small calls connect **peer-to-peer** (a mesh), which is end-to-end encrypted by
construction because no middlebox exists. Larger calls promote to a **selective forwarding
unit**, kept blind by frame-level encryption via Insertable Streams. Media never touches a
service that can read it. The whole thing runs on Cloudflare's **free tier** — there is no
purchased server. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture,
including why an SFU can't run *inside* a Worker and what that implies.

## Status

**Phase 0 — the design system and a clickable shell.** No WebRTC yet: the in-room
experience runs on placeholder participants so the layout, motion, and feel can be judged
before any media plumbing exists. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what ships
when — real mesh calls are Phase 1, the plugin system and blur are Phase 2, scale comes
after.

## Running it

Requires [Bun](https://bun.sh).

**Frontend:**

```bash
cd web
bun install
bun dev          # http://localhost:5173
bun run build    # type-check (strict) + production build
```

The small **"Phase 0"** control at the bottom cycles the room between 1 and 30
participants — the quickest way to see how the stage holds up as a call grows. Your own
camera and mic are real (allow access when prompted); the other tiles are placeholders
until the mesh transport lands.

**Signalling worker** (for real multi-person calls). In a second terminal:

```bash
cd worker
bun install
bun dev          # wrangler dev on http://localhost:8787
```

The Vite dev server proxies `/ws` to it automatically, so the app connects with one
relative URL in dev and prod alike. The worker holds room membership in memory only —
nothing is stored.

## Repository

```
samvad/
├── web/          # React + TypeScript + Vite frontend (Cloudflare Pages)
├── worker/       # Cloudflare Worker + Durable Objects  (Phase 1)
├── crypto/       # MLS via OpenMLS, Rust → WASM          (Phase 4)
├── selfhost/     # optional Go + Pion SFU for full sovereignty (Phase 6+)
├── plugins/      # example and community plugins
└── docs/         # architecture, roadmap, plugins, threat model, design
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, the no-database model, the stack, and the SFU question
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — build order and what each phase delivers
- [`docs/PLUGINS.md`](docs/PLUGINS.md) — the plugin contract and the capability sandbox
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — what Samvad protects against, and what it deliberately does not
- [`docs/DESIGN.md`](docs/DESIGN.md) — visual and interaction direction

## Contributing

The plugin API is how Samvad is meant to grow. If a feature you want can't be built through
the public plugin API, that's a bug in the API — open an issue. First-party features are
held to the same rule: they use only the public API, no privileged access to core.

## License

Open source; license to be finalized before the first tagged release.

---

<div align="center">
<sub>Built by <a href="#">Sangam Lamsal</a>. A network request you didn't ask for is a bug.</sub>
</div>
