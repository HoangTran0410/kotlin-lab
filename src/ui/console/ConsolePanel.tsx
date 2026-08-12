import type { Event } from '../../engine/trace/events'
import { selectConsoleLines } from '../../state/selectors'
import './console.css'

/**
 * Console on VIRTUAL TIME, not wall-clock. `selectConsoleLines` is the ONE
 * output path — the component doesn't filter `PRINTLN` out of `events`
 * itself, it only displays what the selector (a pure derivation from the
 * trace, matching `foldTrace`) returns. So scrubbing `stepIndex` backwards
 * (a prop, not the component's own state) makes lines disappear
 * automatically — there's no state to fall out of sync.
 */
export function ConsolePanel({ events, stepIndex }: {
  events: readonly Event[]
  stepIndex: number
}) {
  const lines = selectConsoleLines(events, stepIndex)

  if (lines.length === 0) {
    return <p className="console-empty">No output yet.</p>
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
