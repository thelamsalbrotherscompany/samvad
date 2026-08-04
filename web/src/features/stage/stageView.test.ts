import { test, expect } from 'bun:test'
import { resolveStageView } from './stageView'
import type { ScreenShare } from './SpeakerStage'

/**
 * The layout contract. `resolveStageView` is the single source of truth for grid-vs-speaker,
 * so the classroom presenter feature lives or dies here: a host spotlight must default everyone
 * to speaker-focus, yet never override a viewer's explicit choice. These cases pin that down so
 * a future change to the precedence is a deliberate one, not an accident.
 */

const SCREEN: ScreenShare = { presenterName: 'X', stream: null }

test('a host spotlight defaults an auto viewer to speaker-focus', () => {
  // Two people would normally be a grid; the spotlight pulls them onto the presenter.
  expect(resolveStageView('auto', false, 2, null, false, true)).toBe('speaker')
})

test('an explicit grid choice wins over a spotlight — the viewer keeps their autonomy', () => {
  expect(resolveStageView('grid', false, 5, null, false, true)).toBe('grid')
})

test('a local pin and a shared screen still force speaker, spotlight or not', () => {
  expect(resolveStageView('grid', false, 5, null, true, false)).toBe('speaker') // pin
  expect(resolveStageView('grid', false, 5, SCREEN, false, false)).toBe('speaker') // screen
})

test('with no spotlight, the pre-existing defaults are unchanged', () => {
  // 1:1 stays a grid; three-plus features the speaker; narrow is always speaker.
  expect(resolveStageView('auto', false, 2, null, false, false)).toBe('grid')
  expect(resolveStageView('auto', false, 3, null, false, false)).toBe('speaker')
  expect(resolveStageView('auto', true, 2, null, false, false)).toBe('speaker')
})
