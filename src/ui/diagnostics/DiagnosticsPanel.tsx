import type { Diagnostic } from '../../engine/validator/diagnostics'
import { clampDiagnosticLine } from './clampLine'
import './diagnostics.css'

/**
 * Đây là chỗ người học chạm nhiều nhất: engine chỉ hỗ trợ một tập con Kotlin,
 * nên lỗi "chưa hỗ trợ" là chuyện thường ngày. Hiện ĐỦ mọi diagnostic (Task 3
 * validate() thu thập hết, không dừng ở lỗi đầu) và luôn kèm `hint` khi có —
 * đó là phần nói cho người học biết dùng gì thay thế.
 */
export function DiagnosticsPanel({ diagnostics, docLines, onJumpToLine }: {
  diagnostics: readonly Diagnostic[]
  /** Tổng số dòng của source HIỆN TẠI — dùng để kẹp `d.line`. Luôn >= 1. */
  docLines: number
  /** Gọi với số dòng ĐÃ KẸP khi user bấm vào một diagnostic. */
  onJumpToLine: (line: number) => void
}) {
  if (diagnostics.length === 0) {
    return <p className="diagnostics-empty">Không có lỗi. Code chạy được.</p>
  }

  return (
    <ul className="diagnostics-list">
      {diagnostics.map((d, i) => {
        const line = clampDiagnosticLine(d.line, docLines)
        return (
          <li key={`${d.line}:${d.col}:${i}`} className="diagnostic-item">
            <button type="button" className="diagnostic-item__button" onClick={() => onJumpToLine(line)}>
              <span className="diagnostic-item__line">dòng {line}</span>
              <span className="diagnostic-item__message">{d.message}</span>
              {d.hint && <span className="diagnostic-item__hint">{d.hint}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
