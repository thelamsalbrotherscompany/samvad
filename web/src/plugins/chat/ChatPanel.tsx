import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Dialog } from 'radix-ui'
import { CloseIcon, SendIcon } from '@/design/icons'
import { cn } from '@/lib/cn'
import type { ChatMessage } from './store'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  messages: ChatMessage[]
  onSend: (text: string) => void
}

/**
 * The chat panel — a right-side sheet with a message list and composer. Presentational:
 * the chat plugin's toolbar control supplies the messages and the send handler. Messages
 * travel P2P over the plugin's E2EE data topic; nothing is stored.
 */
export function ChatPanel({ open, onOpenChange, messages, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, open])

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex h-full w-[min(92vw,380px)] flex-col border-l border-line bg-surface shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-[16px] font-semibold">Chat</Dialog.Title>
            <Dialog.Close
              aria-label="Close chat"
              className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <CloseIcon className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            End-to-end encrypted, peer-to-peer chat for this room
          </Dialog.Description>

          <div
            role="log"
            aria-live="polite"
            aria-label="Messages"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
                <p className="text-[14px] text-ink-muted">No messages yet</p>
                <p className="text-[12px] leading-relaxed text-ink-faint">
                  Messages are end-to-end encrypted, sent straight between participants, and
                  disappear when the room closes.
                </p>
              </div>
            ) : (
              messages.map((m, i) => {
                const prev = messages[i - 1]
                const grouped =
                  !!prev && prev.senderId === m.senderId && m.ts - prev.ts < 60_000
                return <Message key={m.id} m={m} grouped={grouped} />
              })
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                aria-label="Message"
                placeholder="Message…"
                className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface-2/50 px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
              />
              <button
                onClick={submit}
                disabled={!draft.trim()}
                aria-label="Send message"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-base transition-all duration-150 hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SendIcon className="size-4.5" />
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Message({ m, grouped }: { m: ChatMessage; grouped: boolean }) {
  return (
    <div className={cn('flex gap-2.5', grouped && '-mt-2')}>
      <div className="w-8 shrink-0">
        {!grouped && (
          <div
            className={cn(
              'grid size-8 place-items-center rounded-full text-[12px] font-semibold',
              m.self ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-ink-muted',
            )}
          >
            {initials(m.senderName)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-ink">
              {m.self ? 'You' : m.senderName}
            </span>
            <span className="text-[11px] text-ink-faint">{formatTime(m.ts)}</span>
          </div>
        )}
        <div className="text-[14px] leading-relaxed wrap-break-word whitespace-pre-wrap text-ink/90">
          {m.text}
        </div>
      </div>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
