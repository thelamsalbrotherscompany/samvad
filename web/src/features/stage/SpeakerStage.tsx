import type { Participant } from '@/core/participants'
import { cn } from '@/lib/cn'
import { ParticipantTile } from './ParticipantTile'
import { ScreenShareTile } from './ScreenShareTile'
import { useTileActions } from './tileActions'

export type ScreenShare = { presenterName: string; stream: MediaStream | null }

/**
 * Speaker-focused layout — Samvad's default. The featured area holds whatever the
 * room's attention is on: a shared screen if there is one, otherwise the active
 * speaker. Everyone else is a rail of smaller tiles; your own camera is a small
 * self-view PiP.
 *
 * The rail adapts to the screen (docs/DESIGN.md):
 *   - Desktop (wide): a vertical rail down the right, speaker keeps the whole left.
 *   - Phone (tall, narrow): a horizontal filmstrip along the bottom.
 *
 * Raised hands float to the front of the rail, so an attention request never hides
 * behind twenty other tiles.
 */
export function SpeakerStage({
  participants,
  activeSpeakerId,
  screenShare,
  controlsVisible = true,
}: {
  participants: Participant[]
  activeSpeakerId: string | null
  screenShare?: ScreenShare | null
  /** Controls are on screen — reserve room below the filmstrip so they don't cover it. */
  controlsVisible?: boolean
}) {
  const { pinnedId } = useTileActions()
  const self = participants.find((p) => p.isSelf)
  const others = participants.filter((p) => !p.isSelf)

  // A shared screen outranks any speaker: it becomes the feature and everyone,
  // speaker included, moves to the rail.
  if (screenShare) {
    return (
      <Frame
        featured={
          <ScreenShareTile
            presenterName={screenShare.presenterName}
            stream={screenShare.stream}
          />
        }
        rail={handsFirst(others)}
        self={self}
        showSelfPip={self !== undefined}
        controlsVisible={controlsVisible}
      />
    )
  }

  // A pinned person holds the feature; otherwise it follows the active speaker.
  const featured =
    (pinnedId ? others.find((p) => p.id === pinnedId) : undefined) ??
    others.find((p) => p.id === activeSpeakerId) ??
    others[0] ??
    self ??
    participants[0]
  const rail = handsFirst(others.filter((p) => p.id !== featured.id))

  return (
    <Frame
      featured={<ParticipantTile participant={featured} />}
      rail={rail}
      self={self}
      showSelfPip={self !== undefined && featured.id !== self.id}
      controlsVisible={controlsVisible}
    />
  )
}

function Frame({
  featured,
  rail,
  self,
  showSelfPip,
  controlsVisible,
}: {
  featured: React.ReactNode
  rail: Participant[]
  self: Participant | undefined
  showSelfPip: boolean
  controlsVisible: boolean
}) {
  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="relative min-h-0 flex-1 p-3">
        {featured}

        {showSelfPip && self && (
          // Your self-view. Not compact, so it carries your name — you should always
          // be able to see who you're set up as. The speaking ring still fires here
          // when your mic is active, even though the spotlight stays on others.
          <div className="absolute right-5 bottom-5 aspect-video w-32 overflow-hidden rounded-xl shadow-2xl ring-1 ring-line/60 md:w-48">
            <ParticipantTile participant={self} />
          </div>
        )}
      </div>

      {rail.length > 0 && (
        // Mobile: horizontal filmstrip along the bottom. It only reserves space for
        // the floating controls WHILE they're visible — otherwise the reserved gap
        // becomes an empty black slab once the controls auto-hide.
        // Desktop (md+): a fixed-width vertical rail down the right.
        <div
          className={cn(
            'no-scrollbar shrink-0 overflow-x-auto px-3 pb-3 transition-[padding] duration-200 ease-out',
            'md:w-56 md:overflow-x-hidden md:overflow-y-auto md:px-0 md:py-3 md:pr-3',
            controlsVisible && 'max-[680px]:pb-24',
          )}
        >
          <div className="flex gap-2 md:flex-col">
            {rail.map((p) => (
              <div key={p.id} className="aspect-video w-32 shrink-0 md:w-full">
                <ParticipantTile participant={p} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Stable sort putting raised hands first, otherwise preserving order. */
function handsFirst(people: Participant[]): Participant[] {
  return [...people].sort(
    (a, b) => Number(b.handRaised ?? false) - Number(a.handRaised ?? false),
  )
}
