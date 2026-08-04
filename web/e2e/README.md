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

## What it does *not* cover

The full app through the self-hosted SFU (`PionTransport` + the Go SFU + the signalling
Worker) — the msid correlation, real SFU forwarding, and the MLS handshake over the DO relay
end-to-end. That needs the 3-process local run in `../../selfhost/README.md`. The pieces are
each covered (crypto here + unit, MLS handshake in `E2eeSession.test.ts`, SFU in
`selfhost/internal/sfu/sfu_test.go`); wiring them live is the manual step.
