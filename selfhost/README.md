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
- ⏳ Not yet wired to the Samvad app: the browser-side `PionTransport` (implementing the
  client `Transport` interface and reusing the app's lobby/presence signalling) is the next
  step. Right now it stands alone behind the bare test client above.
- ⏳ One audio + one video per participant (camera + mic). Screen-share as a second video
  track, simulcast layer selection, and bandwidth estimation are follow-ups.
