import { Dialog } from 'radix-ui'
import { CloseIcon } from '@/design/icons'
import { ShareContent } from './ShareContent'

/** In-call access to the invite (QR + link). The waiting screen shows the same content inline. */
export function ShareDialog({
  open,
  onOpenChange,
  roomName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomName: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-[18px] font-semibold">Invite people</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <CloseIcon className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Share this room by link or QR code
          </Dialog.Description>

          <div className="mt-5">
            <ShareContent roomName={roomName} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
