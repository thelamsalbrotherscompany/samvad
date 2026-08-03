import { useReactionStore } from './store'

/**
 * Binds the picker to the plugin's data channel. Set in `setup`, so the toolbar control
 * (a plain component, no props) can send a reaction without threading the context through.
 */
let sendFn: ((payload: unknown) => void) | null = null
let selfId = 'self'

export function bindReactions(send: (payload: unknown) => void, self: string): void {
  sendFn = send
  selfId = self
}

/** Broadcast a reaction to the room and pop it on your own tile immediately. */
export function react(emoji: string): void {
  sendFn?.({ emoji })
  useReactionStore.getState().pop(selfId, emoji)
}
