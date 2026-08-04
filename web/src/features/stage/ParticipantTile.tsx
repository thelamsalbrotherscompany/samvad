import { MicOffIcon, HandIcon, PinIcon, RemoveUserIcon, SpotlightIcon } from '@/design/icons'
import { Hint } from '@/design/primitives'
import { TILE_WASHES, initialsOf, type Participant } from '@/core/participants'
import { VideoView } from '@/core/media/VideoView'
import { PluginTileOverlay } from '@/core/plugins/PluginHost'
import { useTileActions } from './tileActions'
import { cn } from '@/lib/cn'

type Props = {
  participant: Participant
  /** Small tiles (filmstrip, PiP, dense grid) drop the name label. */
  compact?: boolean
  /** This tile is the host-spotlighted presenter — mark it as such. */
  spotlighted?: boolean
}

/**
 * Fills its parent. The caller decides the tile's shape and size by sizing the
 * wrapper — a 16:9 box in the grid, a full area for the featured speaker, a fixed
 * width in the filmstrip. Internals scale to the tile via container-query units,
 * so one component looks right from a 96px thumbnail to a full-screen speaker.
 */
export function ParticipantTile({ participant, compact = false, spotlighted = false }: Props) {
  const { name, isSelf, muted, cameraOff, speaking, handRaised, wash, stream, mirrored } =
    participant
  const initials = initialsOf(name)
  const showVideo = !cameraOff && !!stream && stream.getVideoTracks().length > 0
  const { canManage, onRemove, pinnedId, onTogglePin } = useTileActions()
  const removable = canManage && !isSelf
  // Pinning is a personal view choice, offered on anyone but yourself.
  const pinnable = !isSelf && !compact
  const pinned = pinnedId === participant.id

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
          label={isSelf ? 'Your camera' : `${name}'s camera`}
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

      {/* Plugin-contributed tile overlays (e.g. an emoji reaction). */}
      <PluginTileOverlay participant={{ id: participant.id, name, isSelf: !!isSelf }} />

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
        {/* The presenter marker — honest about who the room is being asked to watch. */}
        {spotlighted && !compact && (
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-base">
            <SpotlightIcon className="size-3" />
            Presenter
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

      {/* Pin this person to the featured slot — a local view choice. Shows on hover, and
          stays lit while pinned so it's easy to unpin. */}
      {pinnable && (
        <Hint label={pinned ? 'Unpin' : 'Pin to screen'}>
          <button
            aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the screen`}
            onClick={() => onTogglePin(participant.id)}
            className={cn(
              'absolute right-2.5 bottom-2.5 grid size-7 place-items-center rounded-full backdrop-blur-md transition-all duration-150',
              pinned
                ? 'bg-accent text-base opacity-100'
                : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/70',
            )}
          >
            <PinIcon className="size-3.5" />
          </button>
        </Hint>
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
