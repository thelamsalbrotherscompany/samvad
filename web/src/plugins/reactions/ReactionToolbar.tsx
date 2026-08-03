import { Popover } from 'radix-ui'
import { ReactIcon } from '@/design/icons'
import { react } from './runtime'

const EMOJI = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🙌', '🔥']

/**
 * The reactions picker — a toolbar control contributed by the plugin. Uses Samvad's design
 * tokens and Radix so it looks native, without reaching into core.
 */
export function ReactionToolbar() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label="Send a reaction"
          className="inline-grid size-10 place-items-center rounded-full text-ink-muted transition-all duration-200 ease-out hover:bg-surface-2 hover:text-ink active:scale-95"
        >
          <span className="size-4.75 [&_svg]:size-full">
            <ReactIcon />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={14}
          className="z-50 flex gap-0.5 rounded-2xl border border-line/80 bg-surface/95 p-1.5 shadow-2xl backdrop-blur-2xl"
        >
          {EMOJI.map((e) => (
            <Popover.Close asChild key={e}>
              <button
                onClick={() => react(e)}
                aria-label={`React with ${e}`}
                className="grid size-10 place-items-center rounded-xl text-2xl transition-transform duration-150 hover:scale-125 hover:bg-surface-2"
              >
                {e}
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
