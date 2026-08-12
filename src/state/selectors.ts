import { foldTrace, type WorldState } from '../engine/trace/world'
import type { Event } from '../engine/trace/events'
import { memoizeTwo } from './memo'

/** Counts real fold calls. Only for the regression-guard test to read. */
export const foldStats = { calls: 0 }

const foldMemo = memoizeTwo((events: readonly Event[], stepIndex: number): WorldState => {
  foldStats.calls++
  return foldTrace(events, stepIndex)
})

export const selectWorld = (s: { compiled: { events: readonly Event[] }; stepIndex: number }): WorldState =>
  foldMemo(s.compiled.events, s.stepIndex)

export const selectCurrentLine = (s: Parameters<typeof selectWorld>[0]): number | null =>
  selectWorld(s).srcLine

export const selectConsole = (s: Parameters<typeof selectWorld>[0]): readonly string[] =>
  selectWorld(s).output

export interface ConsoleLine { t: number; text: string }

/**
 * `world.output` (foldTrace) is just `string[]` — it carries no virtual
 * timestamp to show next to each console line. Scans PRINTLN directly from
 * `events` instead, to get that specific event's own `t`, NOT world's final
 * `t` (world.t is the whole trace's current mark at `stepIndex`, not the mark
 * at the moment that line was printed). Still scans exactly `[0, stepIndex)`
 * like foldTrace — the same fold, two different projections of the same
 * trace. tests/ui/console.test.tsx asserts `.map(l => l.text)` matches
 * `foldTrace(events, stepIndex).output` at every step, so the two paths can't
 * drift apart.
 */
export function selectConsoleLines(events: readonly Event[], stepIndex: number): ConsoleLine[] {
  const n = Math.max(0, Math.min(stepIndex, events.length))
  const lines: ConsoleLine[] = []
  for (let i = 0; i < n; i++) {
    const e = events[i]!
    if (e.k === 'PRINTLN') lines.push({ t: e.t, text: e.text })
  }
  return lines
}
