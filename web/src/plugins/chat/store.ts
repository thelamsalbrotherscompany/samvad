import { create } from 'zustand'

export type ChatMessage = {
  id: string
  senderId: string
  senderName: string
  text: string
  ts: number
  /** True for messages you sent. */
  self: boolean
}

type ChatState = {
  messages: ChatMessage[]
  /** Count of messages the local user has seen — the rest are unread. */
  seen: number
  add: (m: ChatMessage) => void
  markAllSeen: () => void
  reset: () => void
}

/**
 * Chat message state, private to the chat plugin. Ephemeral: no history, dies with the
 * call. The toolbar control reads it (list + unread badge) and the data handler feeds it.
 */
export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  seen: 0,
  add: (m) => set((s) => ({ messages: [...s.messages, m] })),
  markAllSeen: () => set((s) => ({ seen: s.messages.length })),
  reset: () => set({ messages: [], seen: 0 }),
}))
