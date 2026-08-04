/**
 * Full-stack E2E for classroom presenter mode over the **mesh** — the lighter of the two app
 * runs, needing only the signalling worker and Vite (no Go SFU), because spotlight + classroom
 * are pure DO relay + UI and behave identically on every transport:
 *
 *   cd worker && bun run dev     # :8787  signalling Durable Object
 *   cd web    && bun run dev     # :5173  the app  (proxies /ws, /ice)
 *
 * then:  bun run test:e2e:classroom     (needs `npx playwright install chromium`)
 *
 * Two headless clients with fake cameras — a host ("Teacher") and a guest ("Student"). It drives
 * the real host controls and asserts the room-wide stage actually propagates:
 *
 *   1. Classroom mode ON  → the non-presenter guest's OWN camera turns off (audio-first, honoured
 *      client-side — the proof the `stage` relay reached the guest and it obeyed).
 *   2. Spotlight the guest → BOTH clients show a "Presenter" badge, and the chrome pill reads
 *      "Student presenting" (host) / "You presenting" (guest).
 *   3. Guest leaves while spotlighted → the host's spotlight self-clears (no ghost presenter).
 *
 * Runs under Node (Playwright's launcher is unreliable under Bun). Exit 0 = pass.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const errors = []

const browser = await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})

async function client(label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`))
  return page
}

/**
 * True if some element's whole trimmed text equals `text` exactly — the *tightest* such element
 * (no child element also carries the full text), so it matches a badge/pill even when it wraps an
 * icon `<svg>`, but never a larger container that merely includes the text among other content.
 */
const hasLeaf = (page, text) =>
  page.evaluate((t) => {
    return [...document.querySelectorAll('*')].some((e) => {
      if ((e.textContent || '').trim() !== t) return false
      return ![...e.children].some((c) => (c.textContent || '').trim() === t)
    })
  }, text)

/** Reveal the auto-hiding control chrome so its buttons become clickable. */
async function reveal(page) {
  await page.mouse.move(500, 680)
  await page.mouse.move(520, 660)
}

/** Poll `fn` until it returns true, or give up after ~`tries` seconds. */
async function until(fn, waiter, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true
    await waiter.waitForTimeout(1000)
  }
  return false
}

let code = 1
try {
  // ── join: Teacher hosts, Student joins and is admitted ──────────────────────────
  const host = await client('host')
  await host.goto(BASE)
  await host.getByRole('button', { name: 'New meeting' }).click()
  await host.getByPlaceholder('How should we call you?').fill('Teacher')
  await host.getByRole('button', { name: 'Join call' }).click({ timeout: 15000 })
  await host.waitForFunction(() => location.hash.length > 1, { timeout: 15000 })
  const hash = await host.evaluate(() => location.hash)
  console.log('room:', hash)

  const guest = await client('guest')
  await guest.goto(`${BASE}/${hash}`)
  await guest.getByPlaceholder('How should we call you?').fill('Student')
  await guest.getByRole('button', { name: 'Join call' }).click({ timeout: 15000 })
  await host.getByRole('button', { name: 'Admit' }).click({ timeout: 12000 })

  const admitted = await until(
    async () => (await hasLeaf(host, 'End-to-end encrypted')) && (await hasLeaf(guest, 'End-to-end encrypted')),
    host,
  )
  console.log('both admitted (mesh E2EE):', admitted)

  // ── 1. Classroom mode ON → the guest (non-presenter) goes audio-first ─────────────
  await reveal(host)
  await host.getByRole('button', { name: 'Participants' }).click({ timeout: 8000 })
  await host.getByRole('switch', { name: 'Classroom mode' }).click({ timeout: 8000 })

  const audioFirst = await until(async () => {
    const guestCamOff = (await guest.getByRole('button', { name: 'Turn camera on' }).count()) === 1
    return guestCamOff && (await hasLeaf(guest, 'Classroom mode'))
  }, guest)
  console.log('classroom → guest camera off + pill:', audioFirst)

  // ── 2. Spotlight the guest → presenter badge + pill on both ───────────────────────
  await host.getByRole('button', { name: 'Spotlight Student for everyone' }).click({ timeout: 8000 })
  await host.keyboard.press('Escape') // close the panel so the stage/chrome are unobstructed

  const spotlighted = await until(async () => {
    const badges = (await hasLeaf(host, 'Presenter')) && (await hasLeaf(guest, 'Presenter'))
    const pills = (await hasLeaf(host, 'Student presenting')) && (await hasLeaf(guest, 'You presenting'))
    return badges && pills
  }, host)
  console.log('spotlight → badges + pills on both:', spotlighted)

  // ── 3. Guest leaves while spotlighted → the host's spotlight self-clears ──────────
  await reveal(guest)
  await guest.getByRole('button', { name: 'Leave call' }).click({ timeout: 8000 })

  const cleared = await until(
    async () => !(await hasLeaf(host, 'Student presenting')) && !(await hasLeaf(host, 'Presenter')),
    host,
  )
  console.log('guest left → host spotlight cleared:', cleared)

  await host.screenshot({ path: 'e2e/classroom-host.png' })

  console.log('pageerrors:', errors.length ? errors : 'none')
  const ok = admitted && audioFirst && spotlighted && cleared && errors.length === 0
  console.log(
    ok
      ? '\nPASS ✅  Classroom mode audio-first, spotlight badges/pills, and clear-on-leave all propagated.'
      : '\nFAIL ❌  See diagnostics above + e2e/classroom-host.png',
  )
  code = ok ? 0 : 1
} catch (e) {
  console.log('ERROR', e?.stack || String(e))
} finally {
  await browser.close()
}
process.exit(code)
