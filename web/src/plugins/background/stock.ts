/**
 * Bundled stock backgrounds — tasteful gradient backdrops for people who want a clean
 * background without uploading a photo. They're **SVG generated in code**: text, so they
 * ship in the bundle (no CDN, non-negotiable #2), a few hundred bytes each, and sharp at any
 * resolution. Each is a data URL that loads into an `Image` and flows through the exact same
 * compositing path as a user-picked picture. The palette stays warm and low-chroma to match
 * the app (docs/DESIGN.md), with a couple of cool/neutral options for range.
 */

export type StockBackground = { id: string; label: string; url: string }

/** Wrap SVG markup (1280×720, so `naturalWidth/Height` drive cover-fit) into a data URL. */
function svg(inner: string): string {
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">` +
    inner +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(doc)}`
}

/** A diagonal two-stop gradient with a soft off-centre radial highlight for a little depth. */
function gradient(a: string, b: string, glow: string): string {
  return svg(
    `<defs>` +
      `<linearGradient id="l" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
      `</linearGradient>` +
      `<radialGradient id="r" cx="0.32" cy="0.28" r="0.9">` +
      `<stop offset="0" stop-color="${glow}" stop-opacity="0.55"/>` +
      `<stop offset="0.6" stop-color="${glow}" stop-opacity="0"/>` +
      `</radialGradient>` +
      `</defs>` +
      `<rect width="1280" height="720" fill="url(#l)"/>` +
      `<rect width="1280" height="720" fill="url(#r)"/>`,
  )
}

export const STOCK_BACKGROUNDS: StockBackground[] = [
  { id: 'dusk', label: 'Dusk', url: gradient('#5a3a2a', '#170f0c', '#a5632f') },
  { id: 'ember', label: 'Ember', url: gradient('#3a231b', '#0f0a08', '#e8a33d') },
  { id: 'sand', label: 'Sand', url: gradient('#d8c3a8', '#8a6f52', '#f2e4cf') },
  { id: 'slate', label: 'Slate', url: gradient('#3c4249', '#14171a', '#7b8794') },
  { id: 'moss', label: 'Moss', url: gradient('#2f3b2e', '#101410', '#6f8a5a') },
  { id: 'night', label: 'Night', url: gradient('#1e2433', '#0a0c12', '#4a5a80') },
]
