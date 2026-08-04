import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useBackgroundStore, type BackgroundMode } from './store'
import { STOCK_BACKGROUNDS } from './stock'

/**
 * The background picker, contributed to the Settings dialog via the `settings` UI slot.
 * Blur / strong-blur, a bundled stock backdrop, or a virtual-background image the user picks
 * from their own device (read to a data URL and kept in memory only — never uploaded, never
 * persisted). All state lives in the plugin store; core knows nothing about it.
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

  const chooseImage = (url: string) => {
    setImage(url)
    setMode('image')
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked later
    if (!file) return
    try {
      chooseImage(await readImageFile(file))
    } catch {
      // Unreadable file — leave the background as it was.
    }
  }

  const isImage = mode === 'image'
  const customActive = isImage && !!image && !STOCK_BACKGROUNDS.some((b) => b.url === image)

  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">Background</h3>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <Chip key={m.value} active={mode === m.value} onClick={() => setMode(m.value)}>
              {m.label}
            </Chip>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {STOCK_BACKGROUNDS.map((bg) => (
            <button
              key={bg.id}
              onClick={() => chooseImage(bg.url)}
              title={bg.label}
              className={cn(
                'aspect-video overflow-hidden rounded-md ring-1 transition',
                isImage && image === bg.url ? 'ring-2 ring-accent' : 'ring-line/60 hover:ring-line',
              )}
            >
              <img src={bg.url} alt={bg.label} className="size-full object-cover" />
            </button>
          ))}

          {/* Custom uploaded image gets its own selectable tile. */}
          {customActive && image && (
            <button
              onClick={() => chooseImage(image)}
              title="Your image"
              className="aspect-video overflow-hidden rounded-md ring-2 ring-accent"
            >
              <img src={image} alt="Your background" className="size-full object-cover" />
            </button>
          )}

          <button
            onClick={pick}
            className="grid aspect-video place-items-center rounded-md text-[11px] text-ink-faint ring-1 ring-dashed ring-line/60 transition hover:text-ink hover:ring-line"
          >
            Upload
          </button>
        </div>

        {isImage && image && (
          <button
            onClick={() => {
              setImage(null)
              setMode('none')
            }}
            className="text-[13px] text-ink-faint transition-colors hover:text-ink"
          >
            Remove background image
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
      </div>
    </section>
  )
}
