import type { Participant } from '@/core/participants'
import { useIsNarrow } from '@/lib/useMediaQuery'
import { GridStage } from './GridStage'
import { SpeakerStage, type ScreenShare } from './SpeakerStage'

export type StageView = 'auto' | 'grid' | 'speaker'
export type { ScreenShare }

type Props = {
  participants: Participant[]
  activeSpeakerId: string | null
  view: StageView
  screenShare?: ScreenShare | null
  /** A remote participant pinned to the featured slot — forces speaker view. */
  pinnedId?: string | null
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
  controlsVisible = true,
}: Props) {
  const narrow = useIsNarrow()
  const effective = resolveStageView(view, narrow, participants.length, screenShare, !!pinnedId)

  return effective === 'speaker' ? (
    <SpeakerStage
      participants={participants}
      activeSpeakerId={activeSpeakerId}
      screenShare={screenShare}
      controlsVisible={controlsVisible}
    />
  ) : (
    <GridStage participants={participants} />
  )
}

/**
 * The single source of truth for which layout is actually on screen. Exported so
 * the control-bar toggle flips the *visible* layout rather than a hidden
 * preference — otherwise "auto" desyncs from what the user sees.
 */
export function resolveStageView(
  view: StageView,
  narrow: boolean,
  count: number,
  screenShare?: ScreenShare | null,
  pinned?: boolean,
): 'grid' | 'speaker' {
  // A shared screen — or a pinned person — takes precedence: both mean "feature one thing".
  if (screenShare || pinned) return 'speaker'
  if (view !== 'auto') return view
  if (narrow) return 'speaker'
  // From three people up, attention beats coverage: feature the speaker, rail the
  // rest. Solo (1) and 1:1 (2) stay as equal tiles — there's no single speaker to
  // feature, and a peer conversation reads better side by side.
  return count >= 3 ? 'speaker' : 'grid'
}
