import { Button } from '@/design/primitives'
import { initialsOf } from '@/core/participants'
import type { PeerInfo } from '@/core/transport/protocol'

/**
 * Host-only: people knocking at the lobby. Always on screen (not tied to chrome
 * auto-hide) because admitting someone is an action the host needs to see and take.
 */
export function KnockRequests({
  knocks,
  onAdmit,
  onDeny,
}: {
  knocks: PeerInfo[]
  onAdmit: (id: string) => void
  onDeny: (id: string) => void
}) {
  if (knocks.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="People waiting to join"
      className="pointer-events-none absolute inset-x-0 top-4 z-40 flex flex-col items-center gap-2 px-4"
    >
      {knocks.map((k) => (
        <div
          key={k.id}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line/80 bg-surface/90 p-2.5 pl-3 shadow-2xl backdrop-blur-2xl"
          style={{ animation: 'samvad-rise 240ms var(--ease-settle) both' }}
        >
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-muted">
            {initialsOf(k.name || 'Guest')}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-[14px] font-medium text-ink">
              {k.name || 'Someone'}
            </div>
            <div className="text-[12px] text-ink-faint">wants to join</div>
          </div>
          <Button variant="ghost" onClick={() => onDeny(k.id)}>
            Deny
          </Button>
          <Button variant="primary" onClick={() => onAdmit(k.id)}>
            Admit
          </Button>
        </div>
      ))}
    </div>
  )
}
