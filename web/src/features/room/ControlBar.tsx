import { Popover } from 'radix-ui'
import { ControlButton } from '@/design/primitives'
import { PluginToolbar } from '@/core/plugins/PluginHost'
import {
  GridIcon,
  HandIcon,
  LeaveIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  ScreenShareIcon,
  SettingsIcon,
  SpeakerViewIcon,
  UsersIcon,
  VideoIcon,
  VideoOffIcon,
  VolumeIcon,
  VolumeOffIcon,
} from '@/design/icons'
import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

type Props = {
  muted: boolean
  cameraOff: boolean
  speakerMuted: boolean
  handRaised: boolean
  sharing: boolean
  visible: boolean
  /** You're the only one here — controls that need an audience are hidden. */
  alone: boolean
  /** Host sees an "end for everyone" option on the leave button. */
  isHost: boolean
  /** The layout currently on screen — the button flips this. */
  layout: 'grid' | 'speaker'
  onToggleMute: () => void
  onToggleSpeaker: () => void
  onToggleCamera: () => void
  onToggleHand: () => void
  onToggleShare: () => void
  onToggleView: () => void
  onOpenSettings: () => void
  onOpenParticipants: () => void
  onLockView: () => void
  onLeave: () => void
  onEndForAll: () => void
}

export function ControlBar({
  muted,
  cameraOff,
  speakerMuted,
  handRaised,
  sharing,
  visible,
  alone,
  isHost,
  layout,
  onToggleMute,
  onToggleSpeaker,
  onToggleCamera,
  onToggleHand,
  onToggleShare,
  onToggleView,
  onOpenSettings,
  onOpenParticipants,
  onLockView,
  onLeave,
  onEndForAll,
}: Props) {
  // Show the icon of the layout the button switches *to*.
  const switchesToGrid = layout === 'speaker'

  // Secondary actions: inline on desktop, folded into a "More" sheet on a phone,
  // where width is scarce and only mic/camera/leave earn a permanent slot.
  // `soloHidden` marks the ones that need an audience — dropped when you're alone.
  const secondary: SecondaryAction[] = [
    {
      label: switchesToGrid ? 'Grid view' : 'Speaker view',
      icon: switchesToGrid ? <GridIcon /> : <SpeakerViewIcon />,
      onClick: onToggleView,
      soloHidden: true,
    },
    {
      label: sharing ? 'Stop sharing' : 'Share screen',
      icon: <ScreenShareIcon />,
      active: sharing,
      activeTone: 'accent',
      onClick: onToggleShare,
      soloHidden: true,
    },
    {
      label: handRaised ? 'Lower hand' : 'Raise hand',
      icon: <HandIcon />,
      active: handRaised,
      activeTone: 'accent',
      onClick: onToggleHand,
      soloHidden: true,
    },
    { label: 'Participants', icon: <UsersIcon />, onClick: onOpenParticipants },
    {
      label: 'Hide controls',
      icon: <LockIcon />,
      onClick: onLockView,
      soloHidden: true,
    },
    { label: 'Settings', icon: <SettingsIcon />, onClick: onOpenSettings },
  ]

  // Alone, the remaining actions are few enough to sit inline everywhere — no
  // "More" sheet needed. With others present, keep the responsive split.
  const secondaryShown = alone ? secondary.filter((a) => !a.soloHidden) : secondary

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 flex justify-center pb-5',
        'transition-all duration-200 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <div className="flex items-center gap-2 rounded-full border border-line/80 bg-surface/80 p-2 shadow-2xl backdrop-blur-2xl">
        <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onToggleMute}>
          {muted ? <MicOffIcon /> : <MicIcon />}
        </ControlButton>

        <ControlButton
          label={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
          active={speakerMuted}
          onClick={onToggleSpeaker}
        >
          {speakerMuted ? <VolumeOffIcon /> : <VolumeIcon />}
        </ControlButton>

        <ControlButton
          label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
          active={cameraOff}
          onClick={onToggleCamera}
        >
          {cameraOff ? <VideoOffIcon /> : <VideoIcon />}
        </ControlButton>

        <div className="mx-1 h-7 w-px bg-line" />

        {/* Plugin-contributed toolbar controls (e.g. the reactions picker). */}
        {!alone && <PluginToolbar />}

        {alone ? (
          // Solo: only self-setup actions remain, few enough to sit inline everywhere.
          <div className="flex items-center gap-2">
            {secondaryShown.map((a) => (
              <SecondaryButton key={a.label} a={a} />
            ))}
          </div>
        ) : (
          <>
            {/* Desktop: the full row. */}
            <div className="hidden items-center gap-2 md:flex">
              {secondaryShown.map((a) => (
                <SecondaryButton key={a.label} a={a} />
              ))}
            </div>

            {/* Phone: everything secondary behind one button. */}
            <div className="md:hidden">
              <MoreMenu actions={secondaryShown} />
            </div>
          </>
        )}

        {/* Gapped and tonally separate — you should never hit Leave by accident. */}
        <div className="ml-2 md:ml-3">
          <LeaveControl isHost={isHost} onLeave={onLeave} onEndForAll={onEndForAll} />
        </div>
      </div>
    </div>
  )
}

type SecondaryAction = {
  label: string
  icon: ReactNode
  active?: boolean
  activeTone?: 'danger' | 'accent'
  /** Hidden when you're the only one here — needs an audience or a stage. */
  soloHidden?: boolean
  onClick?: () => void
}

/** A secondary control (view toggle, share, hand, participants, hide, settings). */
function SecondaryButton({ a }: { a: SecondaryAction }) {
  return (
    <ControlButton
      label={a.label}
      size="md"
      active={a.active}
      activeTone={a.activeTone}
      onClick={a.onClick}
    >
      {a.icon}
    </ControlButton>
  )
}

/**
 * Leave. For a guest it's a plain button. For the host it opens a choice: leave (the
 * call goes on, host passes to the next person) or end it for everyone.
 */
function LeaveControl({
  isHost,
  onLeave,
  onEndForAll,
}: {
  isHost: boolean
  onLeave: () => void
  onEndForAll: () => void
}) {
  if (!isHost) {
    return (
      <ControlButton label="Leave call" tone="danger" onClick={onLeave}>
        <LeaveIcon />
      </ControlButton>
    )
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label="Leave call"
          className="inline-grid size-12 place-items-center rounded-full bg-danger text-base transition-all duration-200 ease-out hover:brightness-110 active:scale-95"
        >
          <span className="size-5.5 [&_svg]:size-full">
            <LeaveIcon />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={14}
          className="z-50 w-64 rounded-2xl border border-line/80 bg-surface/95 p-1.5 shadow-2xl backdrop-blur-2xl"
        >
          <Popover.Close asChild>
            <button
              onClick={onLeave}
              className="w-full rounded-xl p-3 text-left transition-colors duration-150 hover:bg-surface-2"
            >
              <div className="text-[14px] font-medium text-ink">Leave meeting</div>
              <div className="text-[12px] text-ink-faint">
                The call goes on; the host passes to the next person.
              </div>
            </button>
          </Popover.Close>
          <Popover.Close asChild>
            <button
              onClick={onEndForAll}
              className="w-full rounded-xl p-3 text-left transition-colors duration-150 hover:bg-danger-soft"
            >
              <div className="text-[14px] font-medium text-danger">
                End meeting for everyone
              </div>
              <div className="text-[12px] text-ink-faint">
                Removes everyone and closes the room.
              </div>
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MoreMenu({ actions }: { actions: SecondaryAction[] }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label="More options"
          className="inline-grid size-12 place-items-center rounded-full bg-surface-2 text-ink transition-all duration-200 ease-out hover:bg-line active:scale-95"
        >
          <span className="size-5.5 [&_svg]:size-full">
            <MoreIcon />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={14}
          className="z-50 grid w-60 grid-cols-3 gap-1 rounded-2xl border border-line/80 bg-surface/95 p-2 shadow-2xl backdrop-blur-2xl"
        >
          {actions.map((a) => (
            <Popover.Close asChild key={a.label}>
              <button
                onClick={a.onClick}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl p-3 transition-colors duration-150',
                  a.active
                    ? a.activeTone === 'accent'
                      ? 'bg-accent-soft text-accent'
                      : 'bg-danger-soft text-danger'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <span className="size-5 [&_svg]:size-full">{a.icon}</span>
                <span className="text-[11px] leading-tight">{a.label}</span>
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
