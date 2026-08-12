import type { KeyboardEvent } from 'react'
import type { Event } from '../../engine/trace/events'
import { buildMarkers, type NotableKind } from './markers'
import './timeline.css'

/** Shift + arrow jumps 10 steps (Task 16 step 2). */
const BIG_STEP = 10

const MARKER_LABEL: Readonly<Record<NotableKind, string>> = {
  COROUTINE_CREATED: 'Coroutine created',
  EXCEPTION_THROWN: 'Exception thrown',
  FAILURE_PROPAGATED: 'Failure propagated to parent',
  CANCEL_REQUESTED: 'Cancel requested',
  PRINTLN: 'Printed to console',
}

/**
 * Native `<input type="range">`: two-way dragging by pointer, arrow keys,
 * Home/End and screen reader support all come for free — do NOT roll your
 * own dragging with pointer events; reimplementing it means buying back that
 * whole pile of behavior plus its bugs.
 *
 * The only things that need custom wiring: Shift+arrow (jump 10 steps) and
 * plain ←/→/Home/End themselves, because the range input's default keyboard
 * behavior is NOT exercised here (jsdom doesn't simulate it — measured with a
 * probing test before writing this file) and isn't consistent across
 * browsers. `preventDefault()` on the keys we handle ourselves prevents
 * double-stepping when a real browser also applies its own default behavior.
 *
 * `max` is `events.length`, NOT the index where root `Completed` happens —
 * backlog item B3: `GlobalScope.launch` keeps printing after `runBlocking` is
 * done, cutting off there would hide the rest of the trace.
 *
 * `t` (the current virtual time) is read DIRECTLY from
 * `events[stepIndex - 1].t`, without calling `foldTrace` — the last event
 * applied at step `stepIndex` is exactly `events[stepIndex - 1]` (foldTrace
 * applies [0, upTo) and always sets `w.t = e.t` on every iteration), so a
 * direct array lookup is enough, cheaper than folding the whole world.
 */
export function Timeline({ events, stepIndex, setStep }: {
  events: readonly Event[]
  stepIndex: number
  setStep: (n: number) => void
}) {
  const max = events.length
  const disabled = max === 0
  const t = stepIndex > 0 ? (events[stepIndex - 1]?.t ?? 0) : 0
  const markers = buildMarkers(events)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const jump = e.shiftKey ? BIG_STEP : 1
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        setStep(Math.min(max, stepIndex + jump))
        break
      case 'ArrowLeft':
        e.preventDefault()
        setStep(Math.max(0, stepIndex - jump))
        break
      case 'Home':
        e.preventDefault()
        setStep(0)
        break
      case 'End':
        e.preventDefault()
        setStep(max)
        break
      default:
        break
    }
  }

  return (
    <div className="timeline">
      <div className="timeline__track">
        <input
          type="range"
          className="timeline__range"
          aria-label="Timeline scrubber"
          min={0}
          max={max}
          value={disabled ? 0 : stepIndex}
          disabled={disabled}
          onChange={e => setStep(Number(e.target.value))}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="timeline__markers" aria-hidden="true">
        {markers.map(m => (
          <span
            key={`${m.kind}:${m.actorId}:${m.t}`}
            className={`timeline-marker timeline-marker--${m.kind.toLowerCase()}`}
            style={{ left: `${m.pct}%` }}
            title={MARKER_LABEL[m.kind]}
          />
        ))}
      </div>
      <div className="timeline__status">
        <span>step {stepIndex} / {max}</span>
        <span>t = {t}ms</span>
      </div>
    </div>
  )
}
