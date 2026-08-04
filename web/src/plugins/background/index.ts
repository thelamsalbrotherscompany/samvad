import type { SamvadPlugin } from '@/core/plugins/types'
import { BackgroundTransform } from './effect'
import { BackgroundSettings } from './BackgroundSettings'
import { useBackgroundStore, wantsEffect } from './store'

/**
 * Background blur / replace, as a first-party plugin built on the public API only — the
 * dogfood proof that `video-transform` is real (docs/PLUGINS.md §2). It declares a
 * `video-transform` capability and a `settings` UI slot; core owns no segmentation or
 * compositing code.
 *
 * It registers the transform *only while an effect is wanted* and unregisters when off, so
 * the media pipeline publishes the raw camera untouched whenever blur is disabled.
 */

let offTransform: (() => void) | null = null
let unsub: (() => void) | null = null

const backgroundPlugin: SamvadPlugin = {
  id: 'org.samvad.background',
  name: 'Background effects',
  version: '1.0.0',
  author: 'Samvad',
  capabilities: [{ type: 'video-transform' }, { type: 'ui', slot: 'settings' }],

  setup(ctx) {
    ctx.ui?.registerSettingsPanel(BackgroundSettings)

    // Track the store: register the transform when an effect is wanted, drop it when not.
    const sync = () => {
      const wants = wantsEffect(useBackgroundStore.getState())
      if (wants && !offTransform) {
        offTransform = ctx.media?.registerVideoTransform(new BackgroundTransform(), { order: 100 }) ?? null
      } else if (!wants && offTransform) {
        offTransform()
        offTransform = null
      }
    }
    sync()
    unsub = useBackgroundStore.subscribe(sync)
  },

  teardown() {
    unsub?.()
    unsub = null
    offTransform?.()
    offTransform = null
    useBackgroundStore.getState().reset()
  },
}

export default backgroundPlugin
