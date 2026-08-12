import { useCallback, useMemo } from 'react'
import type { NarrationLine } from '../../engine/narrate/narrateTrace'
import type { Event } from '../../engine/trace/events'
import { usePlayback } from '../timeline/usePlayback'
import { GraphCanvas } from './GraphCanvas'
import { LeftoverNotice } from './LeftoverNotice'
import type { ReactFlowGraph } from './toReactFlow'
import './graph-stage.css'

/** Text inside backticks renders in monospace — same convention as NarrationPanel. */
function renderText(text: string): React.ReactNode[] {
  return text.split('`').map((part, i) =>
    i % 2 === 1
      ? <code key={i} className="k-stage__code">{part}</code>
      : <span key={i}>{part}</span>,
  )
}

/**
 * The graph + everything needed to FOLLOW it, gathered in one place.
 *
 * The old layout made the eye run to four corners: code on the left, graph in
 * the middle, explanation and console on the right, scrubber at the bottom.
 * Wanting to know "what's happening" meant glancing right; wanting to scrub
 * meant dragging down to the bottom; `println` only showed up in the side
 * panel, so looking at the graph you couldn't tell which node printed. Four
 * zones for one train of thought.
 *
 * Here: the narration for the step being viewed sits RIGHT BELOW the graph,
 * the scrub buttons sit next to it, `println` shows up right on the node that
 * printed it (see JobNode). The console panel and the full timeline scrubber
 * become things you open when you need to dig deeper, not things you have to
 * look at to understand what's happening.
 *
 * Scrubbing with the buttons here jumps by NARRATED STEP, not by individual
 * event: more than half the events are infrastructure (`THREAD_STATE`,
 * `JOB_STATE`), and stopping there leaves the screen unchanged. The scrubber
 * in the debug panel still moves one event at a time.
 */
export function GraphStage({
  graph, narration, stepIndex, setStep, total, debugOpen, toggleDebug, events, source,
}: {
  graph: ReactFlowGraph
  narration: readonly NarrationLine[]
  stepIndex: number
  setStep: (n: number) => void
  total: number
  debugOpen: boolean
  toggleDebug: () => void
  events: readonly Event[]
  source: string
}) {
  const reached = useMemo(
    () => narration.filter(l => l.index < stepIndex),
    [narration, stepIndex],
  )
  const current = reached.length > 0 ? reached[reached.length - 1]! : null
  const totalSteps = narration.length
  const currentStep = reached.length

  const nextStep = useCallback(
    (cur: number) => {
      const next = narration.find(l => l.index >= cur)
      return next ? next.index + 1 : total
    },
    [narration, total],
  )

  const { playing, play, pause } = usePlayback(stepIndex, setStep, total, nextStep)

  const stepBack = useCallback(() => {
    const before = narration.filter(l => l.index < stepIndex - 1)
    setStep(before.length > 0 ? before[before.length - 1]!.index + 1 : 0)
  }, [narration, stepIndex, setStep])

  const stepForward = useCallback(() => setStep(nextStep(stepIndex)), [nextStep, setStep, stepIndex])

  const empty = total === 0

  return (
    <div className="k-stage">
      <LeftoverNotice events={events} source={source} />
      <div className="k-stage__canvas">
        <GraphCanvas nodes={graph.nodes} edges={graph.edges} />
      </div>

      <div className="k-stage__bar">
        <div className="k-stage__controls">
          <button
            type="button" onClick={() => setStep(0)}
            disabled={empty || stepIndex === 0} aria-label="Back to start"
          >⏮</button>
          <button
            type="button" onClick={stepBack}
            disabled={empty || stepIndex === 0} aria-label="Previous step"
          >◀</button>
          <button
            type="button" className="k-stage__play"
            onClick={playing ? pause : play} disabled={empty}
            // Name is DIFFERENT from the play button in the debug panel,
            // because the two buttons step in different units: here it's a
            // narrated step, there it's a single event. Same name and neither
            // a screen reader nor a test can tell them apart.
            aria-pressed={playing}
            aria-label={playing ? 'Pause step playback' : 'Play by step'}
          >{playing ? '⏸' : '▶'}</button>
          <button
            type="button" onClick={stepForward}
            disabled={empty || stepIndex >= total} aria-label="Next step"
          >▶|</button>
          <span className="k-stage__count" data-testid="stage-count">
            {currentStep}/{totalSteps}
          </span>
          <span className="k-stage__clock">{current ? `${current.t}ms` : '0ms'}</span>
        </div>

        <p
          className={`k-stage__caption k-stage__caption--${current?.tone ?? 'normal'}`}
          data-testid="stage-caption"
        >
          {current
            ? renderText(current.text)
            : <span className="k-stage__hint">Click ▶ or ▶| to step through. Each step is explained right here.</span>}
        </p>

        <button
          type="button"
          className="k-stage__debug"
          onClick={toggleDebug}
          aria-pressed={debugOpen}
        >
          {debugOpen ? 'Close debug panel' : 'Deep debug'}
        </button>
      </div>
    </div>
  )
}
