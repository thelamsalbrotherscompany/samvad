import type { SamvadPlugin } from '@/core/plugins/types'
import { useChatStore } from './store'
import { bindChat } from './runtime'
import { ChatToolbar } from './ChatToolbar'

/**
 * Chat, built entirely on the public plugin API — the second dogfood after reactions
 * (docs/PLUGINS.md §8). It declares one E2EE data topic and one UI slot (`toolbar`) and
 * owns its own button, unread badge, and panel. That it needs no dedicated sidebar-slot
 * machinery is itself evidence the minimal API generalises.
 */
export const chatPlugin: SamvadPlugin = {
  id: 'org.samvad.chat',
  name: 'Chat',
  version: '1.0.0',
  author: 'Samvad',
  capabilities: [
    { type: 'data', topic: 'msg' },
    { type: 'ui', slot: 'toolbar' },
  ],

  setup(ctx) {
    bindChat((payload) => ctx.data?.send(payload), ctx.selfId, ctx.selfName)
    ctx.data?.on((payload, from) => {
      const p = payload as { name?: unknown; text?: unknown; ts?: unknown }
      if (typeof p.text !== 'string' || !p.text) return
      useChatStore.getState().add({
        id: crypto.randomUUID(),
        senderId: from,
        senderName: typeof p.name === 'string' && p.name ? p.name : 'Guest',
        text: p.text,
        ts: typeof p.ts === 'number' ? p.ts : Date.now(),
        self: false,
      })
    })
    ctx.ui?.registerToolbarControl(ChatToolbar)
  },

  teardown() {
    bindChat(() => {}, 'self', 'You')
    useChatStore.getState().reset()
  },
}

export default chatPlugin
