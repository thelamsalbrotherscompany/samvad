import { create } from 'zustand'

/**
 * The background plugin's own state — its config lives here, not in core Settings, because
 * the effect is a plugin (non-negotiable #7). The transform reads this live each frame and
 * the settings panel writes it; changing blur strength or image never rebuilds the pipeline.
 */

export type BackgroundMode = 'none' | 'blur' | 'strong-blur' | 'image'

type BackgroundState = {
  mode: BackgroundMode
  /** A virtual-background image as a data URL — kept in memory on-device only, never sent. */
  image: string | null
  setMode: (mode: BackgroundMode) => void
  setImage: (image: string | null) => void
  reset: () => void
}

export const useBackgroundStore = create<BackgroundState>((set) => ({
  mode: 'none',
  image: null,
  setMode: (mode) => set({ mode }),
  setImage: (image) => set({ image }),
  reset: () => set({ mode: 'none', image: null }),
}))

/** Whether an effect is actually wanted right now — "image" needs a picked image first. */
export function wantsEffect(s: Pick<BackgroundState, 'mode' | 'image'>): boolean {
  return s.mode === 'blur' || s.mode === 'strong-blur' || (s.mode === 'image' && !!s.image)
}

/** Background blur radius (px) for a mode. Only the background is softened; the person stays crisp. */
export function blurPxFor(mode: BackgroundMode): number {
  return mode === 'strong-blur' ? 18 : 9
}
