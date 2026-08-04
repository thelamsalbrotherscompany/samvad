# Samvad self-hosted SFU

A small selective-forwarding unit built on [Pion](https://github.com/pion/webrtc). This is
Samvad's **sovereignty exit** (ROADMAP Phase 6, THREAT-MODEL §4): anyone who declines to
trust Cloudflare Realtime can run this instead and point the client's `PionTransport` at it.

**What it does:** every participant uploads their media *once*; the SFU forwards it to
everyone else. So a client's upload cost is flat regardless of room size — the scaling the
mesh can't give you (mesh clients upload N−1 copies of themselves).

**What it does *not* do:** it forwards RTP and rewrites headers — **it never transcodes**,
and with insertable-streams E2EE on the clients it **cannot read the media** either. That's
the property that keeps a self-hosted SFU inside the non-negotiables.

## Layout

```
selfhost/
├── main.go              # HTTP + websocket server, room routing
├── internal/sfu/        # the forwarding logic (room, track fan-out, signalling)
└── web/index.html       # a bare test client (NOT the app UI) for verifying it works
```

`internal/` per Go convention — nothing here is a public package.

## Run it

```sh
cd selfhost
go run .            # listens on :8088
# or: go build -o samvad-sfu . && ./samvad-sfu -addr :8088
```

Flags: `-addr` (listen address), `-stun` (comma-separated STUN/TURN urls).

## Verify it (two tabs)

1. `go run .`
2. Open `http://localhost:8088/?room=test` in **two** browser tabs (or two devices).
3. Allow camera/mic in each. Each tab should show its own video **and** the other tab's —
   media flowing through the SFU, not peer-to-peer.

The test client is deliberately bare (plain `getUserMedia` + the signalling below); it
exists to exercise the server, not to be the product.

## Verify it with the real app (`PionTransport`)

The browser `PionTransport` (`web/src/core/transport/PionTransport.ts`) routes the app's
media through this SFU while presence/lobby/host still ride the signalling Worker. Testing it
needs **three** processes:

```sh
# 1. the signalling Worker (Durable Object) — presence, lobby, host
cd worker && bun run dev          # :8787

# 2. this SFU — media fan-out
cd selfhost && go run .           # :8088

# 3. the app (Vite proxies /ws→:8787 and /sfu→:8088)
cd web && bun run dev             # :5173
```

Open the app with **`?sfu=1`** (e.g. `http://localhost:5173/?sfu=1#<room>`) in two tabs and
join the same room. You get the full app UI — roster, lobby, names — with media through the
SFU. In **Chromium**, once the MLS group keys, the badge reads **“End-to-end encrypted”**
(`sfu-e2ee`): media is encrypted before it reaches the SFU, which forwards ciphertext it can't
read. Until it keys (or on a browser without Insertable Streams) it honestly reads
**“Transport encrypted only”**. Without `?sfu=1` the app uses the P2P mesh (E2EE) as normal.

## Signalling

One websocket per client at `/sfu?room=<id>`. JSON envelopes:

```jsonc
{ "event": "offer"|"answer"|"candidate", "data": "<JSON-encoded SDP or ICE candidate>" }
```

The **SFU is the sole offerer** (it drives every (re)negotiation as tracks come and go), so
there is never glare. Clients only ever answer and trickle ICE.

## Status

- ✅ Core forwarding: publish, subscribe, per-room fan-out, keyframe (PLI) requests,
  clean teardown. Compiles and `go vet`s clean.
- ✅ Wired to the Samvad app: the browser `PionTransport` implements the client `Transport`
  interface and reuses the app's lobby/presence signalling. Opt in with `?sfu=1` (above).
- ✅ **E2EE (Chromium).** `PionTransport` attaches the built `FrameCryptor` + `E2eeSession`
  (Insertable Streams / MLS) to the SFU connection, keyed over a Durable-Object data relay
  (MLS's untrusted delivery service). The SFU forwards **ciphertext it cannot read** — E2EE
  over a real relay, self-hosted, no Cloudflare. Where Insertable Streams is unavailable the
  transform doesn't attach and the badge honestly stays hop-by-hop.
- ⏳ Data plugins (chat/reactions) over the SFU (the SFU forwards no data channels — the DO
  relay could carry E2EE'd payloads); one audio + one video per participant. Screen-share as a
  second video track, simulcast, and bandwidth estimation are follow-ups.
