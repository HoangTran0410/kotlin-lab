import { foldTrace, type WorldState } from '../engine/trace/world'
import type { Event } from '../engine/trace/events'
import { memoizeTwo } from './memo'

/** Đếm số lần gập thật. Chỉ để test rào chắn hồi quy đọc. */
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
