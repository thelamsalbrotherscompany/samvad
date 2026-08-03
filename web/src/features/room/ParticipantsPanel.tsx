import { Dialog } from 'radix-ui'
import { Toggle } from '@/design/primitives'
import { CloseIcon, HandIcon, MicOffIcon, VideoOffIcon } from '@/design/icons'
import { initialsOf, type Participant } from '@/core/participants'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  participants: Participant[]
  isHost: boolean
  lobbyOpen: boolean
  onSetLobbyOpen: (open: boolean) => void
}

/**
 * The room roster and — for the host — the admission policy. Removing someone lives on
 * their tile (hover to reveal), so it isn't duplicated here.
 */
export function ParticipantsPanel({
  open,
  onOpenChange,
  participants,
  isHost,
  lobbyOpen,
  onSetLobbyOpen,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-[18px] font-semibold">
              In this room <span className="text-ink-faint">· {participants.length}</span>
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <CloseIcon className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Room participants and host controls
          </Dialog.Description>

          {isHost && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2/40 p-3.5">
              <div>
                <div className="text-[14px] text-ink">Let anyone in with the link</div>
                <div className="text-[12px] text-ink-faint">
                  Off: you approve each person from the lobby.
                </div>
              </div>
              <Toggle
                label="Let anyone in with the link"
                checked={lobbyOpen}
                onCheckedChange={onSetLobbyOpen}
              />
            </div>
          )}

          <div className="mt-4 space-y-0.5">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-muted">
                  {initialsOf(p.name)}
                </div>
                <div className="min-w-0 flex-1 truncate text-[14px] text-ink">
                  {p.isSelf ? 'You' : p.name}
                  {p.isSelf && isHost && <span className="text-ink-faint"> · Host</span>}
                </div>
                <div className="flex items-center gap-1.5 text-ink-faint">
                  {p.handRaised && <HandIcon className="size-4 text-accent" />}
                  {p.muted && <MicOffIcon className="size-4" />}
                  {p.cameraOff && <VideoOffIcon className="size-4" />}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
