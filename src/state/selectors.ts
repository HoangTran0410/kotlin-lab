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

export interface ConsoleLine { t: number; text: string }

/**
 * `world.output` (foldTrace) chỉ là `string[]` — không mang mốc thời gian ảo
 * để hiện cạnh mỗi dòng console. Quét lại PRINTLN trực tiếp từ `events` để lấy
 * `t` của riêng event đó, KHÔNG lấy `t` cuối cùng của world (world.t là mốc
 * hiện tại của toàn bộ trace tại `stepIndex`, không phải mốc lúc dòng đó được
 * in). Vẫn quét đúng `[0, stepIndex)` như foldTrace — cùng một cách gập, hai
 * hình chiếu khác nhau của cùng một trace. tests/ui/console.test.tsx khẳng
 * định `.map(l => l.text)` khớp `foldTrace(events, stepIndex).output` ở mọi
 * step, để hai đường không trôi lệch nhau.
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
