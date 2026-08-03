# Samvad — Architecture

> संवाद — *dialogue*. Not "meeting". The product is a conversation between people;
> the software's job is to get out of the way and to forget.

## The one-sentence version

A static browser app on Cloudflare Pages, coordinated by a Durable Object per room that
holds membership in memory and forgets it when the room empties, exchanging
end-to-end-encrypted media that no server in the path can decrypt.

## Deployment constraint (this drives everything)

Samvad deploys on **Cloudflare Pages + Workers**, on the free tier, with **no purchased
server**. This is a hard constraint, not a preference, and it rules out designs that
would otherwise be obvious — see §4.

---

## 1. Core principle: the server forgets

Samvad has **no database**. Not "a database we keep clean" — no database at all.

| State | Where it lives | Lifetime |
|---|---|---|
| Room membership, peer list | RAM, inside the room's Durable Object | Until room empties |
| Signalling messages (SDP/ICE) | Never stored, relayed and dropped | Milliseconds |
| Media | Never stored, forwarded packet-by-packet | Microseconds |
| Encryption keys | Browser memory only, never sent to any server | Until tab closes |
| Chat, reactions, whiteboard | Browser memory, over E2EE data channels | Until tab closes |
| Recordings, transcripts | User's own disk, written by their browser | User's choice |
| User accounts | **Do not exist** | — |

Durable Objects fit this model natively: a DO is instantiated on first join, holds state
in memory, and is evicted once idle. No D1, no KV, no R2, no Durable Object *storage*
API. When the last participant leaves, the meeting has — in a meaningful sense — never
happened.

### Things a database normally does, done statelessly

| Need | Stateless solution |
|---|---|
| Stable link for a recurring class | `roomID = BLAKE2b(passphrase)[0:16]` — same passphrase, same room, zero storage. Also becomes the DO name |
| Authorization | Knowing the link *is* the credential. Optional: host issues a signed token (Ed25519), Worker verifies the signature, stores nothing |
| Scheduled meetings | A link that works whenever it's opened. No server record required |
| Meeting history | Client-side, in the user's browser storage, under their control |
| Waiting room / admission | Held by the host's client; the DO only relays the decision |

### What this honestly costs

- No server-side recording (feature, not bug — but say so out loud)
- A DO eviction drops live room state. Clients auto-rejoin via the deterministic room ID,
  so recovery is seconds, not manual
- No analytics. You will not know how many people use Samvad. Accept this deliberately

---

## 2. What the platform unavoidably does

| Job | Runs on | Persistence |
|---|---|---|
| Serve the app | Cloudflare Pages | Static |
| Signalling (SDP/ICE relay), room membership | Worker + **one Durable Object per room** | In-memory only |
| NAT discovery | `stun.cloudflare.com` | Free, unlimited |
| Relay for peers that can't connect directly (~15%) | Cloudflare Realtime TURN | None |
| Media forwarding at scale | Pluggable SFU — see §4 | None |

WebSocket **Hibernation API** keeps connections alive while the DO sleeps, so idle rooms
cost no duration billing. This is what makes the free tier viable.

---

## 3. Transport abstraction

Three transports behind **one interface**. The UI never knows which is active.

```ts
interface Transport {
  join(roomId: string, identity: Identity): Promise<void>
  publish(track: MediaStreamTrack): Promise<Publication>
  subscribe(peerId: PeerId, kind: TrackKind): Promise<RemoteTrack>
  send(topic: string, payload: Uint8Array): void   // data channel
  on<E extends TransportEvent>(e: E, cb: Handler<E>): Unsubscribe
  leave(): Promise<void>
}
```

| Implementation | Media path | Good for | Phase |
|---|---|---|---|
| `MeshTransport` | Direct peer-to-peer, no media server | 2–5 people | 1 |
| `RealtimeTransport` | Cloudflare Realtime SFU | The hosted instance, classroom scale | 3 |
| `PionTransport` | Self-hosted Go + Pion SFU | Full sovereignty, self-hosters | 6+ |

Rooms start in mesh and promote to SFU at the 5th join. Users never see a mode switch;
they see a meeting that keeps working.

**This abstraction is the most important design decision in the codebase.** It lets
Phase 1 ship on mesh alone, and it prevents the project from being captured by any single
media vendor — including Cloudflare.

---

## 4. The SFU question

**Cloudflare Workers cannot run an SFU.** Workers cannot bind UDP sockets, and WebRTC
media is UDP/SRTP. ("Socket Workers" for raw TCP/UDP/QUIC are announced but unshipped.)
Given the no-purchased-server constraint, a self-written SFU is simply not deployable
today. This is a platform limit, not a design choice.

Therefore the hosted Samvad instance uses **Cloudflare Realtime SFU**, and here is the
honest reasoning:

With insertable-streams E2EE, what each option can see is **identical**:

| | Can read your media | Sees IPs + timing metadata |
|---|---|---|
| Cloudflare Realtime SFU | ❌ No | ✅ Yes |
| A self-hosted Pion SFU | ❌ No | ✅ Yes |
| A hosted SDK (Agora, Twilio) | ✅ **Yes** | ✅ Yes |

The difference between the first two is *who holds the metadata and who can be compelled
to hand it over* — not who can watch the meeting. That is a materially different
proposition from a vendor SDK, and it is why Realtime is acceptable where Agora is not.

**Cloudflare's own [Orange Meets](https://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was/)
is the proof**: an open-source E2EE video app on Workers + Durable Objects + Realtime SFU,
using MLS via OpenMLS compiled to WASM. Their engineers report needing *no SFU changes*
for E2EE — the SFU doesn't care what it forwards.

`PionTransport` remains on the roadmap so that anyone who declines to trust Cloudflare has
a real alternative. **Vendor choice stays the user's, which is the whole point of shipping
this open source.**

### Cost model (free tier: 1,000 GB egress, shared SFU + TURN)

| Scenario | Egress | Free tier lasts |
|---|---|---|
| 4-person **mesh** call | ~0 (P2P; TURN only for the ~15% that need relay) | Effectively unlimited |
| 4-person **SFU** call | ~2.7 GB/hr | ~370 hrs/month |
| 30-person **classroom** | ~40 GB/hr | ~25 hrs/month, then $0.05/GB |

Phases 0–2 cost **$0**. Bandwidth, not CPU, is the scaling cost — as it always is for an SFU.

---

## 5. End-to-end encryption

Baseline WebRTC gives hop-by-hop SRTP: encrypted browser→SFU and SFU→browser, but
**plaintext inside the SFU**. Not good enough for Samvad's claims.

Real E2EE uses **Insertable Streams** (`RTCRtpScriptTransform`). The browser encrypts each
frame's payload with a key no server possesses. The SFU forwards bytes it cannot read; it
only touches RTP headers, which is all forwarding requires.

- **Mesh (Phase 1)** — E2EE by construction. No middlebox exists to trust
- **SFU (Phase 4)** — insertable streams. Key exchange via **MLS (RFC 9420)** using
  OpenMLS, following the Orange Meets design. Originally planned as passphrase-derived
  keys, but Orange Meets demonstrates MLS is tractable and it gives real forward secrecy
  plus clean removal of departed participants

> **Landmine:** encrypting the *entire* frame breaks browser depacketization. Leave the
> first 1–10 VP8 header bytes (version, dimensions) unencrypted. Orange Meets hit this;
> budget for it rather than rediscovering it.

**Stated plainly in the UI and the README:** E2EE hides *content*, never *metadata*. Every
server in the path still observes IPs, room IDs, join/leave times, and speaking patterns.
Anyone claiming otherwise about an SFU-based product is overselling.

---

## 6. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + TypeScript + Vite** → Pages | SPA, not a content site — SSR adds nothing |
| Signalling + rooms | **TypeScript Worker + Durable Objects** | One DO per room; in-memory state is the privacy design |
| Styling | **Tailwind + custom design tokens** | Tokens are the source of truth (see `DESIGN.md`) |
| Accessible primitives | **Radix UI** | Headless; behaviour and a11y only, zero visual opinion |
| Client state | **Zustand** | Small, no ceremony |
| Effects | **WebGL2 + WASM in a Web Worker** | On-device; frames never touch the network |
| E2EE | **Insertable Streams + OpenMLS (Rust→WASM)** | Standard, audited; no custom crypto |
| SFU | **Pluggable** — none → Realtime → Pion | See §4 |
| Database | **None** | See §1 |

The whole control plane is TypeScript. **Go is no longer required** for v1 — it returns
only for the optional self-hosted `PionTransport` in Phase 6+.

---

## 7. On third-party code: the distinction that matters

| | Verdict |
|---|---|
| **Hosted SDKs that can see your media** (Agora, Twilio, Daily, Zoom SDK) | ❌ **Rejected.** Fatal to every claim Samvad makes |
| **Whole open-source servers you'd redistribute** (LiveKit, Jitsi) | ⚠️ **Declined by choice.** Samvad should genuinely be yours |
| **An E2EE-blind SFU you can swap out** (Cloudflare Realtime) | ✅ **Accepted**, because it cannot read media and `PionTransport` keeps the exit open |
| **Libraries you compile in** (React, Radix, OpenMLS, Pion) | ✅ **Use them.** Ingredients, not products |

Writing your own ICE, DTLS, SRTP, or MLS from scratch is a multi-year effort, and
hand-rolled cryptography is *worse* for privacy than audited cryptography — because nobody
has attacked yours yet.

---

## 8. Repository layout

```
samvad/
├── worker/                    # Cloudflare Worker + Durable Objects
│   ├── src/
│   │   ├── index.ts           # router, static asset passthrough
│   │   ├── room.ts            # RoomDO — membership + signalling, in-memory
│   │   └── token.ts           # stateless Ed25519 issue/verify
│   └── wrangler.toml
├── web/
│   ├── src/
│   │   ├── core/              # Transport interface + Mesh/Realtime/Pion impls,
│   │   │                      #   media pipeline, plugin host, crypto
│   │   ├── design/            # tokens, primitives, icons — the design system
│   │   ├── features/          # stage, roster, controls
│   │   └── plugins/           # first-party plugins, via the public plugin API
│   └── index.html
├── crypto/                    # Rust → WASM, MLS via OpenMLS
├── plugins/                   # example + community plugins
├── selfhost/                  # Phase 6+: Go + Pion SFU for sovereignty
└── docs/
```

**Rule with teeth:** first-party plugins in `web/src/plugins/` may only use the public
plugin API — no privileged imports from `core/`. If blur can't be built through the public
API, the API is wrong and gets fixed. This is the only reliable way to keep a plugin
system honest.

---

## Related documents

- [`ROADMAP.md`](ROADMAP.md) — build order and what ships when
- [`PLUGINS.md`](PLUGINS.md) — the module/plugin contract
- [`THREAT-MODEL.md`](THREAT-MODEL.md) — what Samvad protects against, and what it doesn't
- [`DESIGN.md`](DESIGN.md) — visual and interaction direction
