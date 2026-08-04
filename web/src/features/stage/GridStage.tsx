import { useState } from 'react'
import type { Participant } from '@/core/participants'
import { useIsNarrow } from '@/lib/useMediaQuery'
import { cn } from '@/lib/cn'
import { ArrowRightIcon } from '@/design/icons'
import { ParticipantTile } from './ParticipantTile'
import { useGridLayout } from './useGridLayout'

/**
 * Equal-tile gallery. Deliberately the *exception*, not the default — good for small groups
 * where everyone is a peer. Tiles are capped per page so they never shrink into unusable
 * slivers; a classroom-size room **paginates** (‹ Page 2 / 4 ›) so you can actually page
 * through everyone, rather than hiding the overflow behind a dead "+N" cell (docs/DESIGN.md).
 */
export function GridStage({ participants }: { participants: Participant[] }) {
  const narrow = useIsNarrow()
  const pageSize = narrow ? 6 : 16
  const [pageState, setPageState] = useState(0)

  const pageCount = Math.max(1, Math.ceil(participants.length / pageSize))
  // Clamp against the live count so a page stays valid when people join or leave.
  const page = Math.min(pageState, pageCount - 1)
  const shown = participants.slice(page * pageSize, page * pageSize + pageSize)

  const { ref, layout } = useGridLayout(shown.length)
  const boxClass = layout.heightConstrained ? 'h-full w-auto' : 'h-auto w-full'

  return (
    <div className="flex size-full flex-col">
      <div ref={ref} className="min-h-0 flex-1 p-3">
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
        </div>
      </div>

      {pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-3 pb-3">
          <button
            onClick={() => setPageState(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
            className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowRightIcon className="size-4 rotate-180" />
          </button>
          <span className="text-[13px] text-ink-muted tabular-nums" aria-live="polite">
            Page {page + 1} / {pageCount}
          </span>
          <button
            onClick={() => setPageState(page + 1)}
            disabled={page === pageCount - 1}
            aria-label="Next page"
            className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowRightIcon className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
