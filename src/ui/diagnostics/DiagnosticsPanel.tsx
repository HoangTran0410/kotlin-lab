import type { Diagnostic } from '../../engine/validator/diagnostics'
import { clampDiagnosticLine } from './clampLine'
import './diagnostics.css'

/**
 * This is the place learners touch the most: the engine only supports a
 * subset of Kotlin, so "not supported" errors are an everyday thing. Shows
 * EVERY diagnostic (Task 3's validate() collects them all, doesn't stop at
 * the first error) and always includes the `hint` when there is one — that's
 * the part that tells the learner what to use instead.
 */
export function DiagnosticsPanel({ diagnostics, docLines, onJumpToLine }: {
  diagnostics: readonly Diagnostic[]
  /** Total line count of the CURRENT source — used to clamp `d.line`. Always >= 1. */
  docLines: number
  /** Called with the CLAMPED line number when the user clicks a diagnostic. */
  onJumpToLine: (line: number) => void
}) {
  if (diagnostics.length === 0) {
    return <p className="diagnostics-empty">No errors. The code runs.</p>
  }

  return (
    <ul className="diagnostics-list">
      {diagnostics.map((d, i) => {
        const line = clampDiagnosticLine(d.line, docLines)
        return (
          <li key={`${d.line}:${d.col}:${i}`} className="diagnostic-item">
            <button type="button" className="diagnostic-item__button" onClick={() => onJumpToLine(line)}>
              <span className="diagnostic-item__line">line {line}</span>
              <span className="diagnostic-item__message">{d.message}</span>
              {d.hint && <span className="diagnostic-item__hint">{d.hint}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
