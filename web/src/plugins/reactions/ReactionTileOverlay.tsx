import type { TileParticipant } from '@/core/plugins/types'
import { useReactionStore } from './store'

/**
 * A tile overlay contributed by the plugin: the current reaction for this participant,
 * springing in and drifting up inside the tile, then gone. Rendered by core into every
 * tile via the `tile-overlay` slot; the plugin supplies only this component.
 */
export function ReactionTileOverlay({ participant }: { participant: TileParticipant }) {
  const active = useReactionStore((s) => s.active[participant.id])
  if (!active) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center">
      {/* The emoji is decorative to a screen reader; announce it in words instead. */}
      <span className="sr-only" role="status" aria-live="polite">
        {participant.isSelf ? 'You' : participant.name} reacted {active.emoji}
      </span>
      <span
        key={active.key}
        aria-hidden="true"
        className="drop-shadow-lg"
        style={{
          fontSize: 'min(20cqmin, 52px)',
          animation: 'samvad-react 2.6s var(--ease-settle) both',
        }}
      >
        {active.emoji}
      </span>
    </div>
  )
}
