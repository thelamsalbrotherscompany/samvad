import type { ScreenShare } from './SpeakerStage'

/**
 * The pure layout decision, kept free of any component/React imports so it can be unit-tested
 * on its own (see Stage.test.ts) and imported by both the `Stage` component and `App` without
 * dragging the tile tree along.
 */

export type StageView = 'auto' | 'grid' | 'speaker'

/**
 * The single source of truth for which layout is actually on screen. Exported so the
 * control-bar toggle flips the *visible* layout rather than a hidden preference — otherwise
 * "auto" desyncs from what the user sees.
 */
export function resolveStageView(
  view: StageView,
  narrow: boolean,
  count: number,
  screenShare?: ScreenShare | null,
  pinned?: boolean,
  spotlighted?: boolean,
): 'grid' | 'speaker' {
  // A shared screen — or a pinned person — takes precedence: both mean "feature one thing".
  if (screenShare || pinned) return 'speaker'
  // An explicit view choice wins over the softer defaults below (including a host spotlight),
  // so a viewer can still drop to the grid during a presentation.
  if (view !== 'auto') return view
  // The host spotlighted a presenter — default everyone to speaker-focus on them.
  if (spotlighted) return 'speaker'
  if (narrow) return 'speaker'
  // From three people up, attention beats coverage: feature the speaker, rail the
  // rest. Solo (1) and 1:1 (2) stay as equal tiles — there's no single speaker to
  // feature, and a peer conversation reads better side by side.
  return count >= 3 ? 'speaker' : 'grid'
}
