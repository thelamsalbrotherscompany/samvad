import { useEffect, useRef, useState } from 'react'
import { ControlButton } from '@/design/primitives'
import {
  CloseIcon,
  EyeOffIcon,
  MaximizeIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  VideoIcon,
  VideoOffIcon,
} from '@/design/icons'
import { initialsOf } from '@/core/participants'
import { VideoView } from '@/core/media/VideoView'
import { selfVideoStyle, type Settings } from '@/lib/settings'
import { MicMeter } from './MicMeter'

type Props = {
  name: string
  stream: MediaStream | null
  muted: boolean
  cameraOff: boolean
  settings: Settings
  onToggleMute: () => void
  onToggleCamera: () => void
  onClose: () => void
}

/**
 * A large mirror of your own camera, for checking how you look before — or while —
 * others can see you. Uses the real Fullscreen API when available, and works as a
 * full-viewport overlay regardless. Only you ever see this; it's a preview.
 */
export function Mirror({
  name,
  stream,
  muted,
  cameraOff,
  settings,
  onToggleMute,
  onToggleCamera,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hasMic = !!stream && stream.getAudioTracks().length > 0
  const showVideo = !cameraOff && !!stream && stream.getVideoTracks().length > 0

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In OS fullscreen the browser reclaims Esc to exit; only close once we're out,
      // so the first Esc leaves fullscreen and the second dismisses the mirror.
      if (e.key === 'Escape' && !document.fullscreenElement) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // This is a hand-rolled modal, so move focus into it on open and restore it on close, so
  // keyboard/screen-reader users aren't left on the now-obscured page behind it.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    rootRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void rootRef.current?.requestFullscreen().catch(() => {})
    }
  }

  function close() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    onClose()
  }

  const initials = initialsOf(name || 'You')

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Camera preview"
      tabIndex={-1}
      className="fixed inset-0 z-60 flex flex-col bg-base p-4 outline-none sm:p-6"
      style={{ animation: 'samvad-rise 240ms var(--ease-settle) both' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-ink-muted">
          <EyeOffIcon className="size-4 shrink-0" />
          <span className="text-[13px]">Only you can see this — it's a preview</span>
        </div>
        <div className="flex items-center gap-2">
          <ControlButton
            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            size="md"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
          </ControlButton>
          <ControlButton label="Close preview" size="md" onClick={close}>
            <CloseIcon />
          </ControlButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center py-4">
        <div
          className="relative aspect-video max-h-full w-full max-w-5xl overflow-hidden rounded-2xl ring-1 ring-line/60"
          style={{
            containerType: 'size',
            background: cameraOff
              ? 'var(--color-surface)'
              : 'linear-gradient(145deg, #4a2f24 0%, #241813 100%)',
          }}
        >
          {showVideo && stream ? (
            <VideoView stream={stream} label="Your camera" className="size-full" style={selfVideoStyle(settings)} />
          ) : (
            <div className="grid size-full place-items-center">
              {cameraOff ? (
                <div
                  className="grid aspect-square place-items-center rounded-full bg-surface-2 font-semibold text-ink-muted"
                  style={{ height: 'min(28cqmin, 150px)', fontSize: 'min(11cqmin, 52px)' }}
                >
                  {initials}
                </div>
              ) : (
                <span
                  className="font-semibold tracking-tight text-ink/12 select-none"
                  style={{ fontSize: 'min(30cqmin, 220px)' }}
                >
                  {initials}
                </span>
              )}
            </div>
          )}
          {cameraOff && (
            <p className="absolute inset-x-0 bottom-6 text-center text-[13px] text-ink-faint">
              Your camera is off
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
        <div className="flex gap-2">
          {hasMic && (
            <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onToggleMute}>
              {muted ? <MicOffIcon /> : <MicIcon />}
            </ControlButton>
          )}
          <ControlButton
            label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            active={cameraOff}
            onClick={onToggleCamera}
          >
            {cameraOff ? <VideoOffIcon /> : <VideoIcon />}
          </ControlButton>
        </div>
        {hasMic ? (
          <MicMeter stream={stream} muted={muted} className="w-full" />
        ) : (
          <div className="flex items-center gap-3 text-ink-faint">
            <MicOffIcon className="size-4 shrink-0" />
            <span className="text-[13px]">No microphone</span>
          </div>
        )}
      </div>
    </div>
  )
}
