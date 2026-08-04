import type { CSSProperties } from 'react'

export type Settings = {
  /**
   * Mirror your OWN self-view. **On by default, and it must stay that way** — a
   * mirrored self-view is how people expect to see themselves: raise your right hand
   * and it appears on your right, exactly like a bathroom mirror. A non-mirrored
   * self-view (right hand on the left) is disorienting enough that users abandon the
   * app over it. Every major client defaults this on.
   */
  mirror: boolean
  /**
   * Mirror EVERYONE ELSE in your view too, so a remote's raised right hand also
   * appears on your right. **Off by default** — Samvad matches Google Meet, which
   * mirrors only your self-view and shows others in true orientation. This is an
   * opt-in for gesture consistency; it's non-standard and reverses any text a remote
   * holds up to their camera. **Screen shares are never mirrored regardless.** Affects
   * only YOUR view; it changes nothing for other participants.
   */
  mirrorRemote: boolean
  noiseSuppression: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  mirror: true,
  mirrorRemote: false,
  noiseSuppression: true,
}

/**
 * Whether a tile's video should be horizontally flipped in this viewer's client.
 * Self follows `mirror`; everyone else follows `mirrorRemote`. Screen shares pass
 * `isScreenShare` and are never flipped (text must stay readable).
 */
export function shouldMirror(
  s: Pick<Settings, 'mirror' | 'mirrorRemote'>,
  opts: { isSelf: boolean; isScreenShare?: boolean },
): boolean {
  if (opts.isScreenShare) return false
  return opts.isSelf ? s.mirror : s.mirrorRemote
}

/**
 * Styling for a REAL self <video> frame: just the mirror flip. Background blur is now a
 * real effect baked into the stream pixels by the background plugin (`plugins/background`,
 * applied through the media-plugin pipeline), not a CSS filter — so it applies to what peers
 * see too, and only the background is softened.
 */
export function selfVideoStyle(s: Pick<Settings, 'mirror'>): CSSProperties {
  return {
    transform: s.mirror ? 'scaleX(-1)' : undefined,
    objectFit: 'cover',
  }
}
