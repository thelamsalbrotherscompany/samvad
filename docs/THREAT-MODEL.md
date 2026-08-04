# Samvad — Threat Model

A privacy product that overstates its guarantees is worse than one that makes none,
because people act on the claim. This document is written to be **uncomfortably honest**,
and it is the document to update first when the architecture changes.

---

## Who Samvad protects you from

| Adversary | Protected? | How |
|---|---|---|
| **The server operator** (even if that's you) | ✅ Yes, for content | E2EE — the server forwards frames it cannot decrypt |
| **Cloudflare** (Workers, DO, TURN, Realtime SFU) | ⚠️ Content yes, metadata no | The SFU is blind to encrypted frames, but Cloudflare sees IPs and timing. See §7 |
| **A server breach or seizure** | ✅ Yes | No database. There is no historical data to take |
| **A subpoena for meeting records** | ✅ Yes | The records do not exist. Nothing to compel |
| **Passive network eavesdropper (ISP, café Wi-Fi)** | ✅ Yes | DTLS-SRTP + TLS everywhere |
| **Other participants** | ⚠️ Partial | They see and hear the meeting — that's the point. But they cannot read your keys or reach your device |
| **Third-party trackers/analytics** | ✅ Yes | There are none. No CDN, no fonts fetched at runtime, no telemetry |
| **A malicious plugin** | ⚠️ Partial | Capability sandbox blocks network access by default — see limits below |

---

## Who Samvad does **not** protect you from

State this plainly in the README. Users deserve to calibrate.

### 1. Metadata

E2EE hides **content**, never **shape**. While a call is live, the server observes:

- IP addresses of every participant
- Room ID, and who joined which room
- Join and leave times, and therefore call duration
- Packet timing and size — which reveals **who is speaking, and when**
- Rough video resolution and bandwidth

Traffic analysis of an encrypted call still recovers the turn-taking structure of the
conversation. No SFU-based product can honestly claim otherwise.

**Mitigations:** don't log; keep everything in RAM; support Tor and VPN; consider padding
for high-risk deployments (at real bandwidth cost). **Best mitigation: self-host, so the
operator is you.**

### 2. A compromised endpoint

If a participant's device is compromised — malware, screen recorder, a person standing
behind them with a phone — E2EE is irrelevant. The plaintext exists on their screen by
necessity. Nothing Samvad does can change this, and no product's can.

### 3. A malicious *participant*

Anyone in the room can record it. Client-side recording is undetectable in principle.
Samvad shows an indicator for recordings made *through Samvad*; it cannot detect OBS, a
screen recorder, or a phone camera. **Treat everything you say in any meeting as
recordable, everywhere.**

### 4. A hostile *server operator*, on availability and metadata

E2EE stops the operator reading your media. It does not stop them:

- Dropping you from the room
- Logging metadata despite claiming not to
- Serving you **modified frontend JavaScript** that exfiltrates keys

**#3 is the deep one.** In any browser-delivered E2EE app, the server ships the code that
does the encryption. A malicious server can ship malicious code, and no amount of clever
cryptography inside the app can fix that.

Partial answers: Subresource Integrity, reproducible builds, signed releases, and
eventually a browser-extension or desktop build whose code doesn't arrive from the
meeting server. **Full answer: run the server yourself.** Say this out loud — every
browser-based E2EE product shares this weakness, and most quietly decline to mention it.

### 5. Malicious plugins, fully considered

The capability sandbox is real but not absolute:

- ✅ Blocked: network exfiltration (no `fetch`/`WebSocket`/`XHR` in scope), reading other
  plugins' data, DOM access outside the plugin's slot
- ⚠️ Not blocked: a plugin with `video-transform` **sees your camera frames**. It cannot
  send them anywhere — but it could steganographically encode data into the video you
  publish, and a colluding receiver could decode it
- ⚠️ Not blocked: a plugin granted `network` after explicit consent can do as it likes
  with what it can reach

**Therefore:** treat plugin installation with the same seriousness as browser extensions.
The install prompt says what the plugin can do in plain language, before its code runs.

### 6. Cloudflare, specifically

The hosted instance runs entirely on Cloudflare. Being straight about what that means:

**What Cloudflare cannot do:** read your media or your chat. With insertable-streams E2EE,
the Realtime SFU forwards frames it has no key for. Cloudflare's own engineers confirm the
SFU "doesn't care about the contents of the data forwarded."

**What Cloudflare can do:**
- See every participant's IP address, room ID, and join/leave time
- Observe packet timing and size — therefore who is speaking and when
- Serve modified Worker or Pages code (this is §4's problem, and it's the sharp one)
- Terminate the service, or be compelled to log

**Why this is still acceptable:** a self-hosted SFU would see *exactly the same set*
minus the code-serving concern. The difference is metadata custody, not content access —
categorically unlike a vendor SDK that decrypts your video.

**Why it must not become permanent:** `PionTransport` (ROADMAP Phase 6) exists so that
anyone who declines this tradeoff has a real, working alternative rather than a
theoretical one. If that transport is ever allowed to rot, this section becomes a lie.

### 7. Denial of service

Samvad has no rate limiting or abuse prevention worth the name in early phases. A public
instance can be flooded. Put it behind a reverse proxy with rate limits, and prefer
invite-based or passphrase-gated rooms for public deployments.

---

## Cryptographic decisions

| Purpose | Algorithm | Note |
|---|---|---|
| Room ID | `crypto.getRandomValues`, 80-bit, base32 | Unguessable — the id *is* the credential, so it must resist enumeration. Guessing is online (a request per attempt); 2^80 is unreachable |
| Room ID from passphrase (later) | Argon2id → BLAKE2b | Optional "same passphrase → same room", bound to the E2EE key. Adds to, doesn't replace, the random id |
| Group key agreement | **MLS (RFC 9420)** via OpenMLS | Forward secrecy; clean removal on leave |
| Media frame encryption | AES-256-GCM via Insertable Streams | Keyed by MLS epoch secret |
| Transport | DTLS 1.3 + SRTP | Browser-provided |
| Signalling | TLS 1.3 | Standard |
| Tokens (optional) | Ed25519 | Signature verified, nothing stored |

**No custom cryptographic primitives, ever.** Every algorithm above is standard and
audited. The one place original design is unavoidable is key *management* — that is
where scrutiny belongs, and where an external review is worth paying for before v1.0.

### Known gaps, v1

- **Mesh calls use DTLS-SRTP, not MLS.** Small calls are peer-to-peer — genuinely private,
  since no middlebox exists — but without MLS's forward secrecy; MLS runs on the **SFU path**,
  where it's needed (the self-hosted SFU path has it today; the Cloudflare one reuses the same
  crypto once deployed). The encryption indicator states which mode is actually active
  (`mesh-e2ee` / `sfu-e2ee` / `hop-by-hop`)
- **Plugin data is E2EE on both paths.** Chat/reactions ride the P2P channel on mesh (E2EE by
  construction); on the SFU path they ride the Durable-Object relay **sealed under the MLS group
  key**, so the relay forwards ciphertext it can't read — same guarantee as the media
- **Passphrase strength is the user's problem.** A weak passphrase is a weak room. The UI
  generates a strong one by default and resists users weakening it
- **Removal is imperfect.** Rotating the key on leave stops future access, but a departed
  participant who recorded ciphertext keeps what they already had

---

## Design rules that follow from all this

1. **Never claim more than the architecture delivers.** The encryption indicator states
   the actual mode, including when it's merely hop-by-hop
2. **Retention that doesn't exist can't be leaked.** Prefer forgetting over securing
3. **Server plugins that break a guarantee must announce it** — in the room, to everyone,
   not in a config file
4. **Make self-hosting genuinely easy.** It is the only complete answer to §4, so every
   hour spent on one-binary deployment is an hour spent on privacy
5. **Publish this document.** A threat model that lives only in the repo's `docs/` and
   never reaches users is documentation theatre
