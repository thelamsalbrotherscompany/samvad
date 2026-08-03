import { MicOffIcon, HandIcon, RemoveUserIcon } from '@/design/icons'
import { Hint } from '@/design/primitives'
import { TILE_WASHES, initialsOf, type Participant } from '@/core/participants'
import { VideoView } from '@/core/media/VideoView'
import { useTileActions } from './tileActions'
import { cn } from '@/lib/cn'

type Props = {
  participant: Participant
  /** Small tiles (filmstrip, PiP, dense grid) drop the name label. */
  compact?: boolean
}

/**
 * Fills its parent. The caller decides the tile's shape and size by sizing the
 * wrapper — a 16:9 box in the grid, a full area for the featured speaker, a fixed
 * width in the filmstrip. Internals scale to the tile via container-query units,
 * so one component looks right from a 96px thumbnail to a full-screen speaker.
 */
export function ParticipantTile({ participant, compact = false }: Props) {
  const { name, isSelf, muted, cameraOff, speaking, handRaised, wash, stream, mirrored, reaction } =
    participant
  const initials = initialsOf(name)
  const showVideo = !cameraOff && !!stream && stream.getVideoTracks().length > 0
  const { canManage, onRemove } = useTileActions()
  const removable = canManage && !isSelf

  return (
    <div
      className={cn(
        'group relative size-full overflow-hidden rounded-(--radius-tile) ring-inset',
        'transition-shadow ease-settle',
        // Speaking ring fades in fast, out slow — no flicker on cross-talk.
        speaking
          ? 'ring-2 ring-accent duration-400'
          : 'ring-1 ring-line/50 duration-600',
      )}
      style={{
        containerType: 'size',
        background: cameraOff ? 'var(--color-surface)' : TILE_WASHES[wash],
        animation: 'samvad-rise 400ms var(--ease-settle) both',
      }}
    >
      {showVideo && stream ? (
        // The mirror flip lives on the <video> frame — never on text (see shouldMirror).
        <VideoView
          stream={stream}
          className="size-full"
          style={{
            objectFit: 'cover',
            transform: mirrored ? 'scaleX(-1)' : undefined,
          }}
        />
      ) : cameraOff ? (
        <div className="grid size-full place-items-center">
          <div
            className="grid aspect-square place-items-center rounded-full bg-surface-2 font-semibold text-ink-muted"
            style={{ height: 'min(34cqmin, 96px)', fontSize: 'min(13cqmin, 34px)' }}
          >
            {initials}
          </div>
        </div>
      ) : (
        // No stream yet (remote before mesh, or camera unavailable): initials stand-in.
        <div className="grid size-full place-items-center">
          <span
            className="font-semibold tracking-tight text-ink/10 select-none"
            style={{ fontSize: 'min(34cqmin, 140px)' }}
          >
            {initials}
          </span>
        </div>
      )}

      {/* A live emoji reaction: springs in near the bottom, drifts up inside the tile,
          then dissolves. The wrapper centers it (no transform) so the inner span is free
          to animate translateY; keyed by id so each new one replays — even the same emoji. */}
      {reaction && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center">
          <span
            key={reaction.id}
            className="drop-shadow-lg"
            style={{
              fontSize: 'min(20cqmin, 52px)',
              animation: 'samvad-react 2.6s var(--ease-settle) both',
            }}
          >
            {reaction.emoji}
          </span>
        </div>
      )}

      {/* Scrim keeps labels legible over any video. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/55 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-2.5">
        {muted && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-danger/85 text-base">
            <MicOffIcon className="size-3" />
            <span className="sr-only">Muted</span>
          </span>
        )}
        {!compact && (
          <span className="truncate text-[13px] font-medium text-white drop-shadow-sm">
            {isSelf ? `You · ${name}` : name}
          </span>
        )}
      </div>

      {handRaised && (
        <div
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-accent text-base shadow-lg ring-2 ring-accent/30"
          style={{ animation: 'samvad-attention 1.8s ease-in-out infinite' }}
        >
          <HandIcon className="size-4.5" />
          <span className="sr-only">{name} raised their hand</span>
        </div>
      )}

      {/* Host: remove this person, straight from their tile. Hover to reveal (touch: the
          Participants panel has the same action). Skipped on tiny tiles. */}
      {removable && !compact && (
        <Hint label="Remove from call">
          <button
            aria-label={`Remove ${name} from the call`}
            onClick={() => onRemove(participant.id)}
            className="absolute top-2.5 left-2.5 grid size-7 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-md transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-danger hover:text-base"
          >
            <RemoveUserIcon className="size-4" />
          </button>
        </Hint>
      )}
    </div>
  )
}
