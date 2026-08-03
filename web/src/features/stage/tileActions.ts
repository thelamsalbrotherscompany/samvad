import { createContext, useContext } from 'react'

/**
 * Actions available on a participant tile, provided once around the stage so tiles don't
 * need `isHost`/`onKick`/pin state drilled through every layout layer. Removing is
 * host-only (`canManage`); pinning is a local, personal view choice available to anyone.
 */
export type TileActions = {
  canManage: boolean
  onRemove: (id: string) => void
  /** The tile pinned to the featured slot in this viewer's own layout, or null. */
  pinnedId: string | null
  /** Toggle pin for a participant (local view only — never affects anyone else). */
  onTogglePin: (id: string) => void
}

export const TileActionsContext = createContext<TileActions>({
  canManage: false,
  onRemove: () => {},
  pinnedId: null,
  onTogglePin: () => {},
})

export const useTileActions = () => useContext(TileActionsContext)
