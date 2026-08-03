import { useState } from 'react'
import { Button } from '@/design/primitives'
import { ArrowRightIcon } from '@/design/icons'
import { normalizeRoomId } from '@/core/room/roomId'
import { cn } from '@/lib/cn'

/** Accept a bare code or a pasted full link (…/#code); return the clean room id. */
function parseRoomCode(input: string): string {
  const afterHash = input.includes('#') ? input.slice(input.lastIndexOf('#') + 1) : input
  return normalizeRoomId(afterHash)
}

/**
 * The front door. New meeting mints a room and drops you into pre-join; a code joins an
 * existing one. No camera is touched here — the calmest possible first impression
 * (docs/DESIGN.md). The room reads like a well-lit space: warm ambient glow, the mark
 * (two voices sharing one space), restraint everywhere else.
 */
export function Home({
  onNewMeeting,
  onJoin,
}: {
  onNewMeeting: () => void
  onJoin: (code: string) => void
}) {
  const [code, setCode] = useState('')
  const roomId = parseRoomCode(code)
  const invalid = code.trim().length > 0 && roomId.length === 0

  return (
    <div className="relative grid size-full place-items-center overflow-hidden p-6">
      {/* Warm ambient light — the "well-lit room". */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 22%, rgba(232,163,61,0.16), transparent 72%),' +
            'radial-gradient(45% 45% at 78% 88%, rgba(74,158,143,0.10), transparent 70%)',
        }}
      />

      <div
        className="relative w-full max-w-[380px] text-center"
        style={{ animation: 'samvad-rise 600ms var(--ease-settle) both' }}
      >
        <Mark />

        <h1 className="mt-7 text-[42px] leading-none font-semibold tracking-tight">Samvad</h1>
        <p className="mt-2.5 text-[17px] text-ink-muted">संवाद</p>

        <p className="mx-auto mt-5 max-w-[19rem] text-[15px] leading-relaxed text-ink-muted">
          Private video calls. A room exists only while you're in it — then it's gone.
        </p>

        <Button
          variant="primary"
          size="lg"
          className="mt-8 h-13 w-full text-[15px]"
          onClick={onNewMeeting}
        >
          New meeting
        </Button>

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[12px] text-ink-faint">or join with a code</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div
          className={cn(
            'mt-4 flex items-center gap-1.5 rounded-full border bg-surface p-1.5 pl-4 transition-colors duration-200',
            invalid ? 'border-danger/60' : 'border-line focus-within:border-accent/60',
          )}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && roomId) onJoin(roomId)
            }}
            maxLength={200}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="room code or link"
            className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-ink outline-none placeholder:font-sans placeholder:text-ink-faint"
          />
          <button
            aria-label="Join room"
            disabled={!roomId}
            onClick={() => onJoin(roomId)}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink transition-all duration-200 hover:bg-line disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowRightIcon className="size-4" />
          </button>
        </div>

        {invalid && (
          <p className="mt-2 text-[12px] text-danger">
            That doesn't look like a room code — paste the invite link or the code from it.
          </p>
        )}

        <div className="mt-9 flex flex-wrap justify-center gap-2">
          {['End-to-end encrypted', 'No account', 'Nothing stored'].map((label) => (
            <span
              key={label}
              className="rounded-full border border-line/60 bg-surface/40 px-3 py-1 text-[12px] text-ink-muted"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The mark: two overlapping discs — a dialogue, two voices in one space — over a soft
 * glow that breathes. Collapses to still under prefers-reduced-motion.
 */
function Mark() {
  return (
    <div className="relative mx-auto grid h-16 w-24 place-items-center">
      <div
        className="absolute size-24 rounded-full blur-2xl"
        style={{
          background: 'radial-gradient(circle, rgba(232,163,61,0.45), transparent 70%)',
          animation: 'samvad-breathe 5s ease-in-out infinite',
        }}
      />
      <svg
        viewBox="0 0 96 60"
        className="relative w-24"
        style={{ animation: 'samvad-float 6s ease-in-out infinite' }}
        aria-hidden
      >
        <circle cx="30" cy="30" r="30" fill="#e8a33d" opacity="0.92" />
        <circle cx="66" cy="30" r="30" fill="#4a9e8f" opacity="0.82" />
      </svg>
    </div>
  )
}
