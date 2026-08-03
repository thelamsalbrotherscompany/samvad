import type { Participant } from '@/core/participants'
import { useIsNarrow } from '@/lib/useMediaQuery'
import { cn } from '@/lib/cn'
import { ParticipantTile } from './ParticipantTile'
import { useGridLayout } from './useGridLayout'

/**
 * Equal-tile gallery. Deliberately the *exception*, not the default — good for
 * small groups where everyone is a peer. Capped so tiles never shrink into
 * unusable slivers; beyond the cap, the last cell becomes a "+N" and the auto
 * layout would have chosen speaker view anyway (docs/DESIGN.md).
 */
export function GridStage({ participants }: { participants: Participant[] }) {
  const narrow = useIsNarrow()
  const cap = narrow ? 6 : 16

  const overflow = participants.length > cap
  const shown = overflow ? participants.slice(0, cap - 1) : participants
  const hidden = participants.length - shown.length
  const cellCount = shown.length + (overflow ? 1 : 0)

  const { ref, layout } = useGridLayout(cellCount)
  const boxClass = layout.heightConstrained ? 'h-full w-auto' : 'h-auto w-full'

  return (
    <div ref={ref} className="size-full p-3">
      <div
        className="grid size-full gap-3"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}
      >
        {shown.map((p) => (
          <div key={p.id} className="grid min-h-0 min-w-0 place-items-center">
            <div className={cn('aspect-video', boxClass)}>
              <ParticipantTile participant={p} compact={layout.compact} />
            </div>
          </div>
        ))}

        {overflow && (
          <div className="grid min-h-0 min-w-0 place-items-center">
            <div className={cn('aspect-video', boxClass)}>
              <div className="grid size-full place-items-center rounded-(--radius-tile) bg-surface font-medium text-ink-muted ring-1 ring-line/50 ring-inset">
                +{hidden}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
