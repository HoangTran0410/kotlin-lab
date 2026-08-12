import type { Event } from '../../engine/trace/events'
import { selectConsoleLines } from '../../state/selectors'
import './console.css'

/**
 * Console theo THỜI GIAN ẢO, không phải wall-clock. `selectConsoleLines` là
 * đường xuất DUY NHẤT — component không tự lọc `PRINTLN` khỏi `events`, chỉ
 * hiển thị những gì selector (dẫn xuất thuần từ trace, khớp `foldTrace`) trả
 * về. Vì vậy tua ngược `stepIndex` (prop, không phải state riêng của
 * component) tự động làm dòng biến mất — không có state gì để rơi ra đồng bộ.
 */
export function ConsolePanel({ events, stepIndex }: {
  events: readonly Event[]
  stepIndex: number
}) {
  const lines = selectConsoleLines(events, stepIndex)

  if (lines.length === 0) {
    return <p className="console-empty">Chưa có output.</p>
  }

  return (
    <ul className="console-list">
      {lines.map((l, i) => (
        <li key={i} className="console-line">
          <span className="console-line__t">t={l.t}</span>
          <span className="console-line__text">{l.text}</span>
        </li>
      ))}
    </ul>
  )
}
