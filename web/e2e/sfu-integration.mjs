/**
 * Full-stack E2E for the self-hosted SFU path: drives the REAL app with two headless clients
 * and proves media flows through the SFU **and** the badge reports end-to-end encryption.
 *
 * Unlike loopback.mjs (self-contained), this needs the three processes running first:
 *
 *   cd worker   && bun run dev     # :8787  signalling Durable Object
 *   cd selfhost && go run .        # :8088  Pion SFU
 *   cd web      && bun run dev      # :5173  the app  (proxies /ws, /ice, /sfu)
 *
 * then:  bun run test:e2e:sfu      (needs `npx playwright install chromium`)
 *
 * It opens two browser contexts with a fake camera, has one host a "New meeting" on ?sfu=1,
 * the other join and get admitted, asserts BOTH show "End-to-end encrypted" with self+remote
 * video flowing — then has the guest LEAVE and asserts the host drops the tile, stays
 * end-to-end encrypted (the MLS group rekeys to a solo group), and logs no errors.
 * Screenshots land in e2e/*.png (git-ignored). Runs under Node.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const errors = []

const browser = await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE || undefined,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--enable-experimental-web-platform-features',
  ],
})

async function client(label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`))
  return page
}

const videosOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('video')].map((v) => ({ w: v.videoWidth, playing: v.currentTime > 0 })),
  )
const badgeOf = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (e) => /End-to-end encrypted|Transport encrypted only/.test(e.textContent || '') && e.children.length === 0,
    )
    return el ? el.textContent.trim() : '(none)'
  })

let code = 1
try {
  const host = await client('host')
  await host.goto(`${BASE}/?sfu=1`)
  await host.getByRole('button', { name: 'New meeting' }).click()
  await host.getByRole('button', { name: 'Join call' }).click({ timeout: 15000 })
  await host.waitForFunction(() => location.hash.length > 1, { timeout: 15000 })
  const hash = await host.evaluate(() => location.hash)
  console.log('room:', hash)

  const guest = await client('guest')
  await guest.goto(`${BASE}/?sfu=1${hash}`)
  await guest.getByRole('button', { name: 'Join call' }).click({ timeout: 15000 })

  try {
    await host.getByRole('button', { name: 'Admit' }).click({ timeout: 10000 })
    console.log('host admitted the guest')
  } catch {
    console.log('no admit needed (lobby open)')
  }

  // Poll for convergence — MLS keying + SFU media take a few seconds. Up to ~30s.
  const flowing = (v) => v.filter((x) => x.w > 0 && x.playing).length
  let hostBadge = '(none)'
  let guestBadge = '(none)'
  let hostVids = []
  let guestVids = []
  let pass = false
  for (let i = 0; i < 30; i++) {
    await host.waitForTimeout(1000)
    ;[hostBadge, guestBadge] = [await badgeOf(host), await badgeOf(guest)]
    ;[hostVids, guestVids] = [await videosOf(host), await videosOf(guest)]
    if (
      hostBadge === 'End-to-end encrypted' &&
      guestBadge === 'End-to-end encrypted' &&
      flowing(hostVids) >= 2 &&
      flowing(guestVids) >= 2
    ) {
      pass = true
      break
    }
  }
  console.log('established: host', hostBadge, JSON.stringify(hostVids), '| guest', guestBadge, JSON.stringify(guestVids))
  await host.screenshot({ path: 'e2e/sfu-host.png' })
  await guest.screenshot({ path: 'e2e/sfu-guest.png' })

  // ── The guest LEAVES (jiggle the mouse first: the control bar auto-hides when idle) ──
  let leftCleanly = false
  if (pass) {
    await guest.mouse.move(500, 690)
    await guest.mouse.move(520, 680)
    await guest.getByRole('button', { name: 'Leave call' }).click({ timeout: 8000 })
    // Host drops to just itself and STAYS end-to-end encrypted (rekeyed to a solo group).
    for (let i = 0; i < 20; i++) {
      await host.waitForTimeout(1000)
      if (flowing(await videosOf(host)) === 1 && (await badgeOf(host)).startsWith('End-to-end encrypted')) {
        leftCleanly = true
        break
      }
    }
    console.log('after guest left: host videos', flowing(await videosOf(host)), '| badge', await badgeOf(host))
  }

  console.log('pageerrors:', errors.length ? errors : 'none')
  const ok = pass && leftCleanly && errors.length === 0
  console.log(
    ok
      ? '\nPASS ✅  Two clients E2EE over the SFU; guest left cleanly, host stayed encrypted, no errors.'
      : '\nFAIL ❌  See diagnostics + e2e/sfu-*.png',
  )
  code = ok ? 0 : 1
} catch (e) {
  console.log('ERROR', e?.stack || String(e))
} finally {
  await browser.close()
}
process.exit(code)
