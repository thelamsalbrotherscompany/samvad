import { useEffect, useState } from 'react'
import { ChatIcon } from '@/design/icons'
import { useChatStore } from './store'
import { sendMessage } from './runtime'
import { ChatPanel } from './ChatPanel'

/**
 * The chat toolbar control — a button with an unread badge that opens the panel. The plugin
 * owns all of it (button, badge, panel, open state) through the public `toolbar` slot; no
 * sidebar-slot machinery in core is needed, which is itself a check that the API is enough.
 */
export function ChatToolbar() {
  const [open, setOpen] = useState(false)
  const messages = useChatStore((s) => s.messages)
  const seen = useChatStore((s) => s.seen)
  const markAllSeen = useChatStore((s) => s.markAllSeen)
  const unread = Math.max(0, messages.length - seen)

  // Anything visible while the panel is open counts as read.
  useEffect(() => {
    if (open) markAllSeen()
  }, [open, messages.length, markAllSeen])

  return (
    <>
      <button
        aria-label="Chat"
        onClick={() => setOpen(true)}
        className="relative inline-grid size-10 place-items-center rounded-full text-ink-muted transition-all duration-200 ease-out hover:bg-surface-2 hover:text-ink active:scale-95"
      >
        <span className="size-4.75 [&_svg]:size-full">
          <ChatIcon />
        </span>
        {unread > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-base tabular-nums ring-2 ring-surface">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <ChatPanel open={open} onOpenChange={setOpen} messages={messages} onSend={sendMessage} />
    </>
  )
}
