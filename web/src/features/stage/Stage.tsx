import type { Participant } from '@/core/participants'
import { useIsNarrow } from '@/lib/useMediaQuery'
import { GridStage } from './GridStage'
import { SpeakerStage, type ScreenShare } from './SpeakerStage'
import { resolveStageView, type StageView } from './stageView'

export type { StageView, ScreenShare }

type Props = {
  participants: Participant[]
  activeSpeakerId: string | null
  view: StageView
  screenShare?: ScreenShare | null
  /** A remote participant pinned to the featured slot — forces speaker view. */
  pinnedId?: string | null
  /** The host-spotlighted presenter (app id space: `'self'`, a peer id, or null). */
  spotlightId?: string | null
  /** Whether the floating controls are on screen (affects mobile filmstrip spacing). */
  controlsVisible?: boolean
}

/**
 * Chooses the layout. Speaker-focus is the default; a grid is the opt-in
 * exception for solo and 1:1 on a wide screen. A shared screen always forces
 * speaker view — it takes precedence over everything, including a 2-person call
 * (docs/DESIGN.md).
 */
export function Stage({
  participants,
  activeSpeakerId,
  view,
  screenShare,
  pinnedId,
  spotlightId,
  controlsVisible = true,
}: Props) {
  const narrow = useIsNarrow()
  const effective = resolveStageView(
    view,
    narrow,
    participants.length,
    screenShare,
    !!pinnedId,
    !!spotlightId,
  )

  return effective === 'speaker' ? (
    <SpeakerStage
      participants={participants}
      activeSpeakerId={activeSpeakerId}
      screenShare={screenShare}
      spotlightId={spotlightId}
      controlsVisible={controlsVisible}
    />
  ) : (
    <GridStage participants={participants} />
  )
}
