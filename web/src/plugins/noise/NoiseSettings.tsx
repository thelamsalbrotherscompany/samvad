import { Toggle } from '@/design/primitives'
import { useNoiseStore } from './store'

/** The noise-gate control, contributed to the Settings dialog via the `settings` slot. */
export function NoiseSettings() {
  const enabled = useNoiseStore((s) => s.enabled)
  const setEnabled = useNoiseStore((s) => s.setEnabled)

  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">Noise gate</h3>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] text-ink">Fade mic on silence</div>
          <div className="text-[12px] text-ink-faint">
            Attenuates your mic when you're not speaking, to cut steady background noise.
            Complements the built-in noise suppression. Off by default.
          </div>
        </div>
        <Toggle label="Noise gate" checked={enabled} onCheckedChange={setEnabled} />
      </div>
    </section>
  )
}
