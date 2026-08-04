import { CheckIcon, CopyIcon, HandIcon, ShareIcon, ShieldIcon, UsersIcon } from '@/design/icons'
import { Hint } from '@/design/primitives'
import { useCopyLink } from '@/lib/useCopyLink'
import { cn } from '@/lib/cn'

type Props = {
  roomName: string
  count: number
  visible: boolean
  onShare: () => void
  /** Names of everyone with a hand raised, in raise order. */
  raisedHands: string[]
  /**
   * The real encryption mode, never an aspiration. Phase 1 mesh calls are
   * genuinely E2EE; SFU calls only become so in Phase 4 — see docs/THREAT-MODEL.md.
   */
  encryption: 'mesh-e2ee' | 'sfu-e2ee' | 'hop-by-hop'
}

const ENCRYPTION_COPY = {
  'mesh-e2ee': { label: 'End-to-end encrypted', detail: 'Peer-to-peer — no server can see this call.' },
  'sfu-e2ee': { label: 'End-to-end encrypted', detail: 'The relay forwards frames it cannot decrypt.' },
  'hop-by-hop': { label: 'Transport encrypted only', detail: 'The relay can see this call. Not end-to-end.' },
} as const

export function RoomChrome({
  roomName,
  count,
  visible,
  onShare,
  raisedHands,
  encryption,
}: Props) {
  const { copied, copy: copyLink } = useCopyLink(roomName)
  const secure = encryption !== 'hop-by-hop'
  const copy = ENCRYPTION_COPY[encryption]
  const hands = raisedHands.length

  return (
    <div
      className={cn(
        'absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4',
        'transition-all duration-200 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
      )}
    >
      {/* Attention requests surface here, centrally, so they're seen no matter how
          many tiles are on the stage — a corner badge alone gets lost in a crowd. */}
      {hands > 0 && (
        <div role="status" aria-live="polite" className="absolute left-1/2 top-4 -translate-x-1/2">
          <Hint label={raisedHands.join(', ')}>
            <div
              // Names live only in the tooltip, unreachable by keyboard/SR — expose them here.
              aria-label={`${hands} ${hands === 1 ? 'hand' : 'hands'} raised: ${raisedHands.join(', ')}`}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-base shadow-lg"
              style={{ animation: 'samvad-attention 2.4s ease-in-out infinite' }}
            >
              <HandIcon className="size-4 shrink-0" />
              <span className="text-[13px] font-semibold tabular-nums">{hands}</span>
              <span className="hidden text-[13px] font-medium sm:inline">
                {hands === 1 ? 'hand raised' : 'hands raised'}
              </span>
            </div>
          </Hint>
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-full border border-line/80 bg-surface/80 py-1.5 pr-1.5 pl-3.5 backdrop-blur-2xl">
        <span className="font-mono text-[13px] whitespace-nowrap text-ink-muted">
          {roomName}
        </span>
        <Hint label={copied ? 'Copied' : 'Copy invite link'}>
          <button
            onClick={copyLink}
            aria-label={copied ? 'Invite link copied' : 'Copy invite link'}
            className="grid size-7 place-items-center rounded-full text-ink-muted transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
          >
            {copied ? (
              <CheckIcon className="size-4 text-live" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </button>
        </Hint>
        <Hint label="Invite — link & QR">
          <button
            onClick={onShare}
            aria-label="Invite people"
            className="grid size-7 place-items-center rounded-full text-ink-muted transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
          >
            <ShareIcon className="size-4" />
          </button>
        </Hint>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-line/80 bg-surface/80 px-3 py-1.5 backdrop-blur-2xl">
          <UsersIcon className="size-4 text-ink-muted" />
          <span className="text-[13px] font-medium tabular-nums">{count}</span>
        </div>

        {/* Privacy state is always on screen — quiet when normal, loud when not. It's
            icon-only on a phone, so name it (label + detail) and announce a change. */}
        <Hint label={copy.detail}>
          <div
            role="status"
            aria-live="polite"
            aria-label={`${copy.label}. ${copy.detail}`}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 backdrop-blur-2xl',
              secure
                ? 'border-live/25 bg-live/10 text-live'
                : 'border-danger/30 bg-danger/12 text-danger',
            )}
          >
            <ShieldIcon className="size-4 shrink-0" />
            <span className="hidden text-[13px] font-medium sm:inline">{copy.label}</span>
          </div>
        </Hint>
      </div>
    </div>
  )
}
