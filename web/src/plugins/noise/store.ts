import { create } from 'zustand'

/**
 * The noise-gate plugin's state. Off by default — it's an opt-in complement to the browser's
 * built-in noise suppression (a capture constraint in core Settings), not a replacement.
 */
type NoiseState = {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  reset: () => void
}

export const useNoiseStore = create<NoiseState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
  reset: () => set({ enabled: false }),
}))
