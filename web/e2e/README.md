# Browser E2E tests

Most of Samvad's logic is checked by fast unit tests (`bun run test`) — the frame cipher, the
MLS coordinator, the SFU signalling (Go). But one thing they **can't** reach: Insertable
Streams (`RTCRtpSender.createEncodedStreams`) only exists in a real browser. So the actual
"does the encryption survive a live WebRTC codec pipeline?" question needs Chromium.

That's what this directory is for.

## `loopback.html` + `loopback.mjs` — E2EE in a real browser

Serves `loopback.html` with Vite (so it imports the **real** `src/core/crypto/frameCrypto`)
and drives it headless with Playwright. Two in-page `RTCPeerConnection`s carry an animated
video track through the actual encoded-frame transforms, and it asserts:

- encrypted frames flow, and the **correct key decrypts them** → the receiver video plays;
- a **wrong key cannot** decrypt → that receiver's video stays black.

The second point is the one that matters: it proves the media is *genuinely* encrypted, not
passed through.

### Run it

```sh
npx playwright install chromium   # once — downloads the browser
bun run test:e2e
```

It runs under **Node**, not Bun (Playwright's browser launcher is unreliable under Bun). If
the bundled Chromium isn't where Playwright expects, point it at one:

```sh
PW_EXECUTABLE=/path/to/chrome-headless-shell bun run test:e2e
```

## When to run this

**Run it if you touch the crypto or the transport's E2EE wiring** — anything under
`src/core/crypto/` (especially `frameCrypto.ts`), or the frame-transform attachment in
`src/core/transport/PionTransport.ts`. A green unit suite doesn't prove the browser pipeline
still round-trips; this does.

## `sfu-integration.mjs` — the full app over the self-hosted SFU

Drives the **real app** with two headless clients (fake cameras) end-to-end: one hosts a
"New meeting" on `?sfu=1`, the other joins and is admitted, and it asserts **both** show
*End-to-end encrypted* with self+remote video flowing — i.e. media fans out through the Go
SFU, the msid correlation attributes each remote correctly, and the MLS handshake over the DO
relay keyed the cipher.

Unlike the loopback, it needs the three processes running first:

```sh
cd worker   && bun run dev     # :8787
cd selfhost && go run .        # :8088
cd web      && bun run dev      # :5173
# then, in web/:
bun run test:e2e:sfu
```

It writes `e2e/sfu-host.png` / `e2e/sfu-guest.png` (git-ignored) as visual evidence. This is
the automated version of the manual two-tab check in `../../selfhost/README.md`.

## Coverage map

Every layer of the E2EE-over-SFU path has a test: the cipher (`frameCrypto.test.ts` + the
loopback here), the MLS handshake (`E2eeSession.test.ts`), MLS itself (`crypto/mls` cargo
tests), the SFU signalling (`selfhost/internal/sfu/sfu_test.go`), and the whole thing wired
together (`sfu-integration.mjs`).
