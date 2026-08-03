import type { SamvadPlugin } from '@/core/plugins/types'
import { useReactionStore } from './store'
import { bindReactions } from './runtime'
import { ReactionToolbar } from './ReactionToolbar'
import { ReactionTileOverlay } from './ReactionTileOverlay'

/**
 * Emoji reactions, built entirely on the public plugin API — the dogfood test for that API
 * (docs/PLUGINS.md §8). It declares one E2EE data topic and two UI slots, and touches no
 * core internals. If this couldn't be written through the public API, the API would be wrong.
 */
export const reactionsPlugin: SamvadPlugin = {
  id: 'org.samvad.reactions',
  name: 'Reactions',
  version: '1.0.0',
  author: 'Samvad',
  capabilities: [
    { type: 'data', topic: 'r' },
    { type: 'ui', slot: 'toolbar' },
    { type: 'ui', slot: 'tile-overlay' },
  ],

  setup(ctx) {
    bindReactions((payload) => ctx.data?.send(payload), ctx.selfId)
    ctx.data?.on((payload, from) => {
      const emoji = (payload as { emoji?: unknown }).emoji
      if (typeof emoji === 'string' && emoji) useReactionStore.getState().pop(from, emoji)
    })
    ctx.ui?.registerToolbarControl(ReactionToolbar)
    ctx.ui?.registerTileOverlay(ReactionTileOverlay)
  },

  teardown() {
    bindReactions(() => {}, 'self')
    useReactionStore.setState({ active: {} })
  },
}

export default reactionsPlugin
