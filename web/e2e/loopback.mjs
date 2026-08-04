/**
 * Headless browser E2E: proves the frame cipher actually encrypts and decrypts LIVE WebRTC
 * media in a real Chromium — the part unit tests (which run in Node/Bun) can't reach, because
 * Insertable Streams (`RTCRtpSender.createEncodedStreams`) only exists in the browser.
 *
 * It serves `loopback.html` via Vite (so it imports the real `src/core/crypto/frameCrypto`),
 * drives it with Playwright, and asserts: encrypted frames flow, the correct key decrypts them
 * (video plays), and a WRONG key cannot (video stays black — so it's genuinely encrypted, not
 * passthrough).
 *
 * Run:  `bun run test:e2e`   (needs `npx playwright install chromium` once).
 * Runs under Node (Playwright's launcher is unreliable under Bun). Set PW_EXECUTABLE to point
 * at a specific Chromium build if the bundled one isn't installed.
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'

const vite = await createServer({ server: { port: 5183 }, logLevel: 'silent' })
await vite.listen()
const port = vite.config.server.port
const url = `http://localhost:${port}/e2e/loopback.html`

let code = 1
try {
  const browser = await chromium.launch({
    executablePath: process.env.PW_EXECUTABLE || undefined,
    args: ['--enable-experimental-web-platform-features'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(url)
  await page.waitForFunction('window.__done === true', { timeout: 25000 })
  const r = await page.evaluate('window.__result')
  console.log('RESULT:\n' + JSON.stringify(r, null, 2))
  await browser.close()

  const pass =
    r &&
    r.ok === true &&
    r.encryptedFramesSent > 0 &&
    r.decryptedFrames_correctKey > 0 &&
    r.video_correctKey.playing === true &&
    r.video_wrongKey.playing === false // negative control: wrong key can't decode
  console.log(
    pass
      ? '\nPASS ✅  Real FrameCryptor encrypts/decrypts live WebRTC media in Chromium; a wrong key cannot.'
      : '\nFAIL ❌',
  )
  code = pass ? 0 : 1
} catch (e) {
  console.log('ERROR', e?.stack || String(e))
} finally {
  await vite.close()
}
process.exit(code)
