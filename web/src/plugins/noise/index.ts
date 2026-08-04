import type { SamvadPlugin } from '@/core/plugins/types'
import { NoiseGateTransform } from './effect'
import { NoiseSettings } from './NoiseSettings'
import { useNoiseStore } from './store'

/**
 * Noise gate, a first-party `audio-transform` plugin — the dogfood proof that audio
 * transforms work, mirroring the background plugin's shape. Registers its transform only
 * while enabled (opt-in, off by default), so the mic passes through untouched otherwise.
 */

let off: (() => void) | null = null
let unsub: (() => void) | null = null

const noisePlugin: SamvadPlugin = {
  id: 'org.samvad.noise',
  name: 'Noise gate',
  version: '1.0.0',
  author: 'Samvad',
  capabilities: [{ type: 'audio-transform' }, { type: 'ui', slot: 'settings' }],

  setup(ctx) {
    ctx.ui?.registerSettingsPanel(NoiseSettings)

    const sync = () => {
      const on = useNoiseStore.getState().enabled
      if (on && !off) {
        off = ctx.media?.registerAudioTransform(new NoiseGateTransform()) ?? null
      } else if (!on && off) {
        off()
        off = null
      }
    }
    sync()
    unsub = useNoiseStore.subscribe(sync)
  },

  teardown() {
    unsub?.()
    unsub = null
    off?.()
    off = null
    useNoiseStore.getState().reset()
  },
}

export default noisePlugin
