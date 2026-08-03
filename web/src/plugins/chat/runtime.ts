import { useChatStore } from './store'

/** Bound in `setup` so the composer can send without threading the context through. */
let sendFn: ((payload: unknown) => void) | null = null
let selfId = 'self'
let selfName = 'You'

export function bindChat(send: (payload: unknown) => void, id: string, name: string): void {
  sendFn = send
  selfId = id
  selfName = name
}

/** Broadcast a chat message and show it locally at once (never echoed back over the wire). */
export function sendMessage(text: string): void {
  const body = text.trim()
  if (!body) return
  const ts = Date.now()
  sendFn?.({ name: selfName, text: body, ts })
  useChatStore.getState().add({
    id: crypto.randomUUID(),
    senderId: selfId,
    senderName: selfName,
    text: body,
    ts,
    self: true,
  })
}
