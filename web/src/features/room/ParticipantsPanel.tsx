import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { Toggle } from '@/design/primitives'
import {
  CloseIcon,
  HandIcon,
  MicOffIcon,
  RemoveUserIcon,
  SearchIcon,
  VideoOffIcon,
} from '@/design/icons'
import { initialsOf, type Participant } from '@/core/participants'
import type { ActivityEvent } from '@/core/transport/MeshTransport'
import { cn } from '@/lib/cn'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  participants: Participant[]
  activity: ActivityEvent[]
  isHost: boolean
  lobbyOpen: boolean
  onSetLobbyOpen: (open: boolean) => void
  /** Host: remove a participant. Absent for non-hosts. */
  onRemove?: (id: string) => void
}

type Tab = 'people' | 'activity'

/**
 * The room roster (with a name filter and, for the host, a per-person remove button) plus
 * an Activity log of who joined and left — so the host can tell when someone drops mid-call.
 * Removing is always-visible so it works on touch; the log is in-memory and dies with the room.
 */
export function ParticipantsPanel({
  open,
  onOpenChange,
  participants,
  activity,
  isHost,
  lobbyOpen,
  onSetLobbyOpen,
  onRemove,
}: Props) {
  const [tab, setTab] = useState<Tab>('people')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? participants.filter((p) => p.name.toLowerCase().includes(q)) : participants

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-surface p-6 shadow-2xl">
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
            Room participants, host controls, and join/leave activity
          </Dialog.Description>

          {/* People / Activity */}
          <div className="mt-4 flex shrink-0 gap-1 rounded-xl bg-surface-2/40 p-1">
            {(['people', 'activity'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 rounded-lg py-1.5 text-[13px] font-medium transition-colors',
                  tab === t
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t === 'people' ? 'People' : 'Activity'}
              </button>
            ))}
          </div>

          {tab === 'people' ? (
            <>
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

              <div className="relative mt-4 shrink-0">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search participants"
                  aria-label="Search participants"
                  className="w-full rounded-xl border border-line bg-surface-2/40 py-2.5 pr-3 pl-9 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
                />
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                {shown.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2/40"
                  >
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
                    {isHost && onRemove && !p.isSelf && (
                      <button
                        onClick={() => onRemove(p.id)}
                        aria-label={`Remove ${p.name} from the call`}
                        className="grid size-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-danger hover:text-base"
                      >
                        <RemoveUserIcon className="size-4" />
                      </button>
                    )}
                  </div>
                ))}

                {shown.length === 0 && (
                  <div className="px-2 py-8 text-center text-[13px] text-ink-faint">
                    No one matches “{query.trim()}”.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {activity.length === 0 ? (
                <div className="px-2 py-10 text-center text-[13px] text-ink-faint">
                  No one has come or gone yet.
                </div>
              ) : (
                activity.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-2 py-2">
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        e.kind === 'joined' ? 'bg-accent-2' : 'bg-ink-faint',
                      )}
                    />
                    <div className="min-w-0 flex-1 truncate text-[14px]">
                      <span className="font-medium text-ink">{e.name}</span>{' '}
                      <span className="text-ink-muted">
                        {e.kind === 'joined' ? 'joined' : 'left'}
                      </span>
                    </div>
                    <span className="text-[12px] text-ink-faint tabular-nums">
                      {formatTime(e.ts)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
