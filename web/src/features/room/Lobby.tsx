import { Button } from '@/design/primitives'
import { ShieldIcon } from '@/design/icons'
import { initialsOf, type Participant } from '@/core/participants'
import { ParticipantTile } from '@/features/stage/ParticipantTile'

type Variant = 'connecting' | 'waiting' | 'denied' | 'removed' | 'ended' | 'not-found'

/**
 * What a guest sees before they're in the room: connecting, then waiting for the host to
 * admit them, or turned away. Their self-view stays visible while they wait, so the
 * moment they're let in they already look right.
 */
export function Lobby({
  variant,
  roomName,
  self,
  onLeave,
}: {
  variant: Variant
  roomName: string
  self: Participant
  onLeave: () => void
}) {
  // "You're out" states — declined, removed, meeting ended, or the room never existed.
  const out =
    variant === 'denied' ||
    variant === 'removed' ||
    variant === 'ended' ||
    variant === 'not-found'

  return (
    <div className="grid size-full place-items-center overflow-y-auto p-6">
      <div
        className="flex w-full max-w-md flex-col items-center text-center"
        style={{ animation: 'samvad-rise 500ms var(--ease-settle) both' }}
      >
        {out ? (
          <div className="grid size-20 place-items-center rounded-full bg-danger-soft text-2xl font-semibold text-danger">
            {initialsOf(self.name)}
          </div>
        ) : (
          <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-2xl ring-1 ring-line/60">
            <ParticipantTile participant={self} />
          </div>
        )}

        {!out && (
          <div className="mt-6 flex items-center gap-2 text-ink-muted">
            <span className="relative flex size-2">
              <span
                className="absolute inline-flex size-full rounded-full bg-accent/60"
                style={{ animation: 'samvad-breathe 1.6s ease-in-out infinite' }}
              />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            <span className="text-[13px]">
              {variant === 'connecting' ? 'Connecting…' : 'Knocking…'}
            </span>
          </div>
        )}

        <h2 className="mt-3 text-[22px] font-semibold">
          {variant === 'connecting'
            ? 'Joining the room'
            : variant === 'waiting'
              ? 'Waiting to be let in'
              : variant === 'removed'
                ? 'You were removed'
                : variant === 'ended'
                  ? 'The meeting ended'
                  : variant === 'not-found'
                    ? 'Room not found'
                    : "You weren't let in"}
        </h2>

        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          {variant === 'connecting' ? (
            <>Reaching the room…</>
          ) : variant === 'waiting' ? (
            <>
              The host has been asked to admit you to{' '}
              <span className="font-mono text-ink">{roomName}</span>. Hang tight — this
              won't take long.
            </>
          ) : variant === 'removed' ? (
            <>The host removed you from the call.</>
          ) : variant === 'ended' ? (
            <>The host ended the meeting for everyone.</>
          ) : variant === 'not-found' ? (
            <>
              <span className="font-mono text-ink">{roomName}</span> doesn't exist, or it
              already ended. Check the code, or start a new meeting.
            </>
          ) : (
            <>The host declined your request to join. You can head back and try again.</>
          )}
        </p>

        <Button variant={out ? 'primary' : 'secondary'} className="mt-6" onClick={onLeave}>
          {out ? 'Back to home' : 'Cancel'}
        </Button>

        {!out && (
          <div className="mt-8 flex items-center gap-2 text-ink-faint">
            <ShieldIcon className="size-3.5 shrink-0" />
            <span className="text-[12px]">
              The room code got you here; only the host can let you in.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
