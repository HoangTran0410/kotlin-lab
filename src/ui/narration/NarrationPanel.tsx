import { useEffect, useRef } from 'react'
import type { NarrationLine } from '../../engine/narrate/narrateTrace'
import './narration.css'

/**
 * Splits a string on backticks: the part inside backticks prints in a code font.
 *
 * `narrate` wraps every identifier (job name, thread, exception type) in
 * backticks — the one convention shared between the engine and the display
 * layer, see narrate.ts. No dangerouslySetInnerHTML: builds React elements
 * directly.
 */
function renderText(text: string): React.ReactNode[] {
  return text.split('`').map((part, i) =>
    i % 2 === 1
      ? <code key={i} className="k-narration__code">{part}</code>
      : <span key={i}>{part}</span>,
  )
}

/**
 * Step-by-step narration: the sentence for the step being viewed, plus every
 * sentence before it.
 *
 * Only shows sentences that HAVE HAPPENED (`index < stepIndex`). Showing
 * sentences that haven't happened yet would spoil the outcome — a learner
 * should only learn as far as they've scrubbed.
 *
 * A pure component, doesn't read the store itself: `lines`/`stepIndex`/`onJump`
 * are all props, matching the shape of LessonNav and the other panels.
 */
export function NarrationPanel({ lines, stepIndex, onJump }: {
  lines: readonly NarrationLine[]
  stepIndex: number
  onJump: (step: number) => void
}) {
  const reached = lines.filter(l => l.index < stepIndex)
  const last = useRef<HTMLLIElement>(null)

  // Auto-scroll to the newest sentence when scrubbing. `block: 'nearest'` so
  // it doesn't drag the whole page. Called optionally: jsdom (the test
  // environment) does NOT install scrollIntoView, and a side panel crashing
  // the whole App in tests is too high a price for a scroll effect.
  useEffect(() => {
    last.current?.scrollIntoView?.({ block: 'nearest' })
  }, [stepIndex])

  if (reached.length === 0) {
    return (
      <p className="k-narration__empty" data-testid="narration-empty">
        Drag the timeline below (or press ▶) to run step by step. Each step will be
        explained here.
      </p>
    )
  }

  return (
    <ol className="k-narration">
      {reached.map((l, i) => {
        const isCurrent = i === reached.length - 1
        return (
          <li
            key={l.index}
            ref={isCurrent ? last : undefined}
            className={`k-narration__line k-narration__line--${l.tone}${isCurrent ? ' k-narration__line--current' : ''}`}
            data-testid={isCurrent ? 'narration-current' : 'narration-line'}
          >
            <button
              type="button"
              className="k-narration__jump"
              // +1 because stepIndex counts "how many events have been
              // applied", while index is the event's position in the array.
              onClick={() => onJump(l.index + 1)}
              title="Jump to this step"
            >
              <span className="k-narration__t">{l.t}ms</span>
              <span className="k-narration__text">{renderText(l.text)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
