import { create } from 'zustand'

/** One live reaction on a participant's tile. `key` changes each pop so it re-animates. */
type Active = { key: string; emoji: string }

type ReactionState = {
  /** Keyed by participant id (the self tile id for your own, peer id for others). */
  active: Record<string, Active>
  pop: (participantId: string, emoji: string) => void
}

/**
 * Transient reaction state, private to the reactions plugin. The toolbar picker writes it
 * (for your own reaction), the data handler writes it (for others'), and the tile overlay
 * reads it. Nothing here is persisted — each reaction clears itself after it animates.
 */
export const useReactionStore = create<ReactionState>((set) => ({
  active: {},
  pop: (participantId, emoji) => {
    const key = crypto.randomUUID()
    set((s) => ({ active: { ...s.active, [participantId]: { key, emoji } } }))
    setTimeout(() => {
      set((s) => {
        if (s.active[participantId]?.key !== key) return s // superseded by a newer one
        const next = { ...s.active }
        delete next[participantId]
        return { active: next }
      })
    }, 2800)
  },
}))
