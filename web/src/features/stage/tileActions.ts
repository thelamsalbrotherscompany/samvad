import { createContext, useContext } from 'react'

/**
 * Host actions available on a participant tile, provided once around the stage so tiles
 * don't need `isHost`/`onKick` drilled through every layout layer.
 */
export type TileActions = {
  canManage: boolean
  onRemove: (id: string) => void
}

export const TileActionsContext = createContext<TileActions>({
  canManage: false,
  onRemove: () => {},
})

export const useTileActions = () => useContext(TileActionsContext)
