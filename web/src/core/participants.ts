/**
 * PHASE 0 SCAFFOLDING ONLY.
 *
 * Fake participants so the stage layout, motion, and density can be judged before
 * any WebRTC exists. Deleted in Phase 1, when `Transport` supplies real peers.
 * Nothing outside the stage may depend on this module.
 */

export type Participant = {
  id: string
  name: string
  /** Local user — rendered mirrored, labelled "You". */
  isSelf?: boolean
  muted: boolean
  cameraOff: boolean
  speaking: boolean
  handRaised?: boolean
  /**
   * Whether this tile's video is horizontally flipped in the local viewer's client
   * (self always; others by preference; never screen shares). Rides on the
   * participant so every tile flips consistently. Applied to the real <video> in
   * Phase 1 — never to the text placeholder. See `shouldMirror` and docs/DESIGN.md.
   */
  mirrored?: boolean
  /**
   * Live video for this tile, when available. Set on self in Phase 1; remote streams
   * attach once the mesh transport lands. No stream → the initials placeholder.
   */
  stream?: MediaStream | null
  /** Index into TILE_WASHES. Stable per participant so tiles never re-colour. */
  wash: number
}

/**
 * Tile background washes — a tight, warm, low-chroma family so a full grid reads
 * as one calm room, not a paint sampler. Every wash is dark and warm-leaning; no
 * blue-grey (docs/DESIGN.md). These are placeholders that real video replaces in
 * Phase 1 — their only job now is to not undercut the palette.
 */
export const TILE_WASHES = [
  'linear-gradient(150deg, #3a2b20 0%, #241a14 100%)', // warm brown
  'linear-gradient(150deg, #33302a 0%, #201d18 100%)', // taupe
  'linear-gradient(150deg, #3c2b25 0%, #251b16 100%)', // terracotta
  'linear-gradient(150deg, #343123 0%, #201e15 100%)', // olive-brown
  'linear-gradient(150deg, #283331 0%, #181f1e 100%)', // muted teal, deep
  'linear-gradient(150deg, #34272f 0%, #20181d 100%)', // muted plum-brown
] as const

const NAMES = [
  'Sangam Lamsal',
  'Aarati Shrestha',
  'Bikash Thapa',
  'Priya Sharma',
  'Daniel Okonkwo',
  'Mei Tanaka',
  'Rohan Gurung',
  'Elena Marković',
  'Tomas Novák',
  'Fatima Al-Rashid',
  'Kwame Mensah',
  'Sofia Rossi',
]

export function makeParticipants(count: number): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i % NAMES.length],
    isSelf: i === 0,
    muted: i !== 0 && i % 3 === 0,
    cameraOff: i !== 0 && i % 5 === 4,
    speaking: false,
    handRaised: i === 6,
    wash: i % TILE_WASHES.length,
  }))
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}
