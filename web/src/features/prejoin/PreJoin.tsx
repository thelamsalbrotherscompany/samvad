import { useState } from 'react'
import { Button, ControlButton, Hint } from '@/design/primitives'
import {
  HeadphonesIcon,
  MaximizeIcon,
  MicIcon,
  MicOffIcon,
  SettingsIcon,
  ShieldIcon,
  VideoIcon,
  VideoOffIcon,
} from '@/design/icons'
import { initialsOf } from '@/core/participants'
import { VideoView } from '@/core/media/VideoView'
import type { MediaErrorKind } from '@/core/media/useLocalMedia'
import { selfVideoStyle, type Settings } from '@/lib/settings'
import { MicMeter } from '@/features/room/MicMeter'
import { Mirror } from '@/features/room/Mirror'

type Props = {
  roomName: string
  initialName: string
  settings: Settings
  stream: MediaStream | null
  mediaError: MediaErrorKind | null
  muted: boolean
  cameraOff: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onOpenSettings: () => void
  onJoin: (displayName: string) => void
}

const ERROR_INFO: Record<MediaErrorKind, { title: string; detail: string }> = {
  denied: {
    title: 'Camera & mic blocked',
    detail: 'Allow access in your browser to be seen and heard — or join to just listen.',
  },
  notfound: {
    title: 'No camera or microphone',
    detail: 'None found on this device. You can still join to listen and take part in chat.',
  },
  insecure: {
    title: 'Insecure connection',
    detail: 'Camera and mic need a secure (https) connection.',
  },
  other: {
    title: "Can't reach your devices",
    detail: 'Something is blocking the camera or mic. You can still join to listen.',
  },
}

/**
 * The highest-anxiety moment in any call app, and therefore the one worth the most
 * design attention: "do I look and sound alright?" answered before anyone sees you.
 */
export function PreJoin({
  roomName,
  initialName,
  settings,
  stream,
  mediaError,
  muted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
  onOpenSettings,
  onJoin,
}: Props) {
  const [name, setName] = useState(initialName)
  const [mirror, setMirror] = useState(false)
  const hasCamera = !!stream && stream.getVideoTracks().length > 0
  const hasMic = !!stream && stream.getAudioTracks().length > 0
  const showVideo = hasCamera && !cameraOff

  return (
    <div className="grid size-full place-items-center overflow-y-auto p-6">
      <div
        className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.3fr_1fr]"
        style={{ animation: 'samvad-rise 500ms var(--ease-settle) both' }}
      >
        {/* Preview */}
        <div>
          <div
            className="relative aspect-video w-full overflow-hidden rounded-2xl ring-1 ring-line/60"
            style={{
              background: cameraOff
                ? 'var(--color-surface)'
                : 'linear-gradient(145deg, #4a2f24 0%, #241813 100%)',
            }}
          >
            {showVideo && stream ? (
              <VideoView stream={stream} label="Your camera preview" className="size-full" style={selfVideoStyle(settings)} />
            ) : mediaError ? (
              <div role="alert" className="grid size-full place-items-center px-6 text-center">
                <div className="flex max-w-xs flex-col items-center gap-3">
                  <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-ink-muted">
                    <VideoOffIcon className="size-7" />
                  </span>
                  <div>
                    <p className="text-[14px] font-medium text-ink">
                      {ERROR_INFO[mediaError].title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                      {ERROR_INFO[mediaError].detail}
                    </p>
                  </div>
                </div>
              </div>
            ) : !hasCamera && stream ? (
              // Captured audio but no camera device — say so, rather than a ghost initial.
              <div className="grid size-full place-items-center px-6 text-center">
                <div className="flex flex-col items-center gap-3">
                  <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-ink-muted">
                    <VideoOffIcon className="size-7" />
                  </span>
                  <p className="text-[13px] text-ink-muted">
                    No camera — you'll join with audio only.
                  </p>
                </div>
              </div>
            ) : cameraOff ? (
              <div className="grid size-full place-items-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="grid size-20 place-items-center rounded-full bg-surface-2 text-2xl font-semibold text-ink-muted">
                    {initialsOf(name || 'You')}
                  </div>
                  <p className="text-[13px] text-ink-faint">Your camera is off</p>
                </div>
              </div>
            ) : (
              <div className="grid size-full place-items-center">
                <span className="text-7xl font-semibold tracking-tight text-ink/12 select-none">
                  {initialsOf(name || 'You')}
                </span>
              </div>
            )}

            <Hint label="Settings">
              <button
                aria-label="Settings"
                onClick={onOpenSettings}
                className="absolute top-3 left-3 grid size-9 place-items-center rounded-full bg-base/40 text-ink-muted backdrop-blur-md transition-colors duration-200 hover:bg-base/60 hover:text-ink"
              >
                <SettingsIcon className="size-4" />
              </button>
            </Hint>

            {/* No camera means nothing to preview — don't offer "see how you look". */}
            {hasCamera && (
              <Hint label="Expand — see how you look">
                <button
                  aria-label="Expand preview"
                  onClick={() => setMirror(true)}
                  className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-base/40 text-ink-muted backdrop-blur-md transition-colors duration-200 hover:bg-base/60 hover:text-ink"
                >
                  <MaximizeIcon className="size-4" />
                </button>
              </Hint>
            )}

            {(hasMic || hasCamera) && (
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-4">
                {hasMic && (
                  <ControlButton
                    label={muted ? 'Unmute' : 'Mute'}
                    active={muted}
                    onClick={onToggleMute}
                  >
                    {muted ? <MicOffIcon /> : <MicIcon />}
                  </ControlButton>
                )}
                {hasCamera && (
                  <ControlButton
                    label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                    active={cameraOff}
                    onClick={onToggleCamera}
                  >
                    {cameraOff ? <VideoOffIcon /> : <VideoIcon />}
                  </ControlButton>
                )}
              </div>
            )}
          </div>

          {hasMic ? (
            <MicMeter stream={stream} muted={muted} className="mt-4" />
          ) : (
            <div className="mt-4 flex items-center gap-3 text-ink-faint">
              <MicOffIcon className="size-4 shrink-0" />
              <span className="text-[13px]">No microphone</span>
            </div>
          )}
        </div>

        {/* Join */}
        <div>
          <p className="text-[13px] font-medium tracking-wide text-ink-faint uppercase">
            You're about to join
          </p>
          <h1 className="mt-2 font-mono text-[28px] leading-tight font-semibold">{roomName}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            No one else is here yet. Share the link and they can join straight from their
            browser — no account, no download.
          </p>

          <label className="mt-7 block">
            <span className="text-[13px] font-medium text-ink-muted">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="How should we call you?"
              className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink transition-colors duration-200 outline-none placeholder:text-ink-faint focus:border-accent/60"
            />
          </label>

          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
            disabled={!name.trim()}
            onClick={() => onJoin(name.trim())}
          >
            Join call
          </Button>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-live/20 bg-live/6 p-3.5">
            <ShieldIcon className="mt-0.5 size-4 shrink-0 text-live" />
            <p className="text-[13px] leading-relaxed text-ink-muted">
              <span className="font-medium text-live">End-to-end encrypted.</span> Samvad keeps
              no database — this room stops existing the moment everyone leaves.
            </p>
          </div>

          {/* Echo happens when a speaker's sound reaches a mic. Headphones break that loop. */}
          {hasMic && (
            <p className="mt-3 flex items-center gap-2 px-1 text-[12px] text-ink-faint">
              <HeadphonesIcon className="size-4 shrink-0" />
              Headphones are best — they stop others from hearing an echo of themselves.
            </p>
          )}
        </div>
      </div>

      {mirror && (
        <Mirror
          name={name}
          stream={stream}
          muted={muted}
          cameraOff={cameraOff}
          settings={settings}
          onToggleMute={onToggleMute}
          onToggleCamera={onToggleCamera}
          onClose={() => setMirror(false)}
        />
      )}
    </div>
  )
}
