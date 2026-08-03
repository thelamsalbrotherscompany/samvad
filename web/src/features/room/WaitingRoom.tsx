import { useState } from 'react'
import type { Participant } from '@/core/participants'
import { Hint } from '@/design/primitives'
import { MaximizeIcon, ShieldIcon } from '@/design/icons'
import { ParticipantTile } from '@/features/stage/ParticipantTile'
import type { Settings } from '@/lib/settings'
import { Mirror } from './Mirror'
import { ShareContent } from './ShareContent'

type Props = {
  self: Participant
  roomName: string
  settings: Settings
  stream: MediaStream | null
  muted: boolean
  cameraOff: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
}

/**
 * The stage when you're the only one here. The content is the *invitation*, not
 * your own face full-screen — when you're alone, the job to be done is getting
 * someone else in (docs/DESIGN.md, "Empty room"). Your self-view stays present but
 * modest, just to confirm you're set up — with an expand button to check yourself.
 */
export function WaitingRoom({
  self,
  roomName,
  settings,
  stream,
  muted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
}: Props) {
  const [mirror, setMirror] = useState(false)
  const hasCamera = !!stream && stream.getVideoTracks().length > 0

  return (
    <div className="grid size-full place-items-center overflow-y-auto p-6">
      <div
        className="flex w-full max-w-md flex-col items-center text-center"
        style={{ animation: 'samvad-rise 500ms var(--ease-settle) both' }}
      >
        <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-2xl ring-1 ring-line/60">
          <ParticipantTile participant={self} />
          {hasCamera && (
            <Hint label="Expand — see how you look">
              <button
                aria-label="Expand preview"
                onClick={() => setMirror(true)}
                className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-base/40 text-ink-muted backdrop-blur-md transition-colors duration-200 hover:bg-base/60 hover:text-ink"
              >
                <MaximizeIcon className="size-3.5" />
              </button>
            </Hint>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2 text-ink-muted">
          <span className="relative flex size-2">
            <span
              className="absolute inline-flex size-full rounded-full bg-accent/60"
              style={{ animation: 'samvad-breathe 2s ease-in-out infinite' }}
            />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          <span className="text-[13px]">Waiting for others to join</span>
        </div>

        <h2 className="mt-3 text-[22px] font-semibold">You're the only one here</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          Scan the code or share the link — anyone can join straight from their browser,
          no account, no download.
        </p>

        <div className="mt-6 w-full">
          <ShareContent roomName={roomName} />
        </div>

        <div className="mt-6 flex items-center gap-2 text-ink-faint">
          <ShieldIcon className="size-3.5 shrink-0" />
          <span className="text-[12px]">
            End-to-end encrypted · this room disappears when everyone leaves
          </span>
        </div>
      </div>

      {mirror && (
        <Mirror
          name={self.name}
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
