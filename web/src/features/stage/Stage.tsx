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
  controlsVisible = true,
}: Props) {
  const narrow = useIsNarrow()
  const effective = resolveStageView(view, narrow, participants.length, screenShare)

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
): 'grid' | 'speaker' {
  // A shared screen takes precedence over everything.
  if (screenShare) return 'speaker'
  if (view !== 'auto') return view
  if (narrow) return 'speaker'
  // From three people up, attention beats coverage: feature the speaker, rail the
  // rest. Solo (1) and 1:1 (2) stay as equal tiles — there's no single speaker to
  // feature, and a peer conversation reads better side by side.
  return count >= 3 ? 'speaker' : 'grid'
}
