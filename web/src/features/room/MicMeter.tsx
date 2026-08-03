import { MicIcon, MicOffIcon } from '@/design/icons'
import { useAudioLevel } from '@/core/media/useAudioLevel'
import { cn } from '@/lib/cn'

/**
 * Owns its own level from the live stream, so the animation-rate updates re-render
 * only this meter, not whatever screen contains it.
 */
export function MicMeter({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null
  muted: boolean
  className?: string
}) {
  const level = useAudioLevel(stream, !muted)
  const bars = 24
  const lit = Math.round(level * bars)

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {muted ? (
        <MicOffIcon className="size-4 shrink-0 text-danger" />
      ) : (
        <MicIcon className="size-4 shrink-0 text-ink-muted" />
      )}
      <div className="flex h-4 flex-1 items-center gap-0.75">
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-full flex-1 rounded-full transition-colors duration-75',
              !muted && i < lit ? 'bg-live' : 'bg-surface-2',
            )}
          />
        ))}
      </div>
      <span className="w-28 shrink-0 text-right text-[12px] text-ink-faint">
        {muted ? 'Microphone off' : 'Say something'}
      </span>
    </div>
  )
}
