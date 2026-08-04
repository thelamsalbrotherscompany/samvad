import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useBackgroundStore, type BackgroundMode } from './store'

/**
 * The background picker, contributed to the Settings dialog via the `settings` UI slot.
 * Blur / strong-blur / a virtual-background image the user picks from their own device —
 * read to a data URL and kept in memory only (never uploaded, never persisted). All state
 * lives in the plugin store; core knows nothing about it.
 */

const MODES: { value: BackgroundMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'blur', label: 'Blur' },
  { value: 'strong-blur', label: 'Strong blur' },
]

/** Read a picked image file into a data URL, kept entirely in memory on this device. */
function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-[13px] transition-colors',
        active ? 'bg-accent font-medium text-base' : 'bg-surface-2 text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function BackgroundSettings() {
  const mode = useBackgroundStore((s) => s.mode)
  const image = useBackgroundStore((s) => s.image)
  const setMode = useBackgroundStore((s) => s.setMode)
  const setImage = useBackgroundStore((s) => s.setImage)

  const fileRef = useRef<HTMLInputElement>(null)
  const pick = () => fileRef.current?.click()

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked later
    if (!file) return
    try {
      setImage(await readImageFile(file))
      setMode('image')
    } catch {
      // Unreadable file — leave the background as it was.
    }
  }

  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">Background</h3>
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <Chip key={m.value} active={mode === m.value} onClick={() => setMode(m.value)}>
              {m.label}
            </Chip>
          ))}
          <Chip active={mode === 'image'} onClick={() => (image ? setMode('image') : pick())}>
            Image
          </Chip>
        </div>

        {(mode === 'image' || image) && (
          <div className="flex items-center gap-3">
            {image ? (
              <img src={image} alt="" className="h-12 w-20 rounded-md object-cover ring-1 ring-line/60" />
            ) : (
              <div className="grid h-12 w-20 place-items-center rounded-md bg-surface-2 text-[11px] text-ink-faint ring-1 ring-line/60">
                No image
              </div>
            )}
            <button onClick={pick} className="text-[13px] text-accent hover:underline">
              {image ? 'Change' : 'Choose image…'}
            </button>
            {image && (
              <button
                onClick={() => {
                  setImage(null)
                  if (mode === 'image') setMode('none')
                }}
                className="text-[13px] text-ink-faint transition-colors hover:text-ink"
              >
                Remove
              </button>
            )}
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
      </div>
    </section>
  )
}
