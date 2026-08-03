import { Button } from '@/design/primitives'
import { CheckIcon, CopyIcon } from '@/design/icons'
import { useCopyLink } from '@/lib/useCopyLink'
import { QRCode } from './QRCode'

/**
 * Everything needed to invite someone: a scannable QR (for phones), the room code, and
 * the full link with one-tap copy. Reused inline on the waiting screen and inside the
 * in-call ShareDialog.
 */
export function ShareContent({ roomName }: { roomName: string }) {
  const { link, copied, copy } = useCopyLink(roomName)

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl bg-white p-3 shadow-lg">
        <QRCode value={link} className="size-40 [&>svg]:block [&>svg]:size-full" />
      </div>

      <p className="mt-4 text-[13px] text-ink-muted">Scan to join — or share the link</p>

      <div className="mt-2 font-mono text-[15px] text-ink">{roomName}</div>

      <div className="mt-3 flex w-full items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pl-3.5">
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[13px] text-ink-muted">
          {link}
        </span>
        <Button variant="primary" onClick={copy}>
          {copied ? (
            <>
              <CheckIcon className="size-4" /> Copied
            </>
          ) : (
            <>
              <CopyIcon className="size-4" /> Copy
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
