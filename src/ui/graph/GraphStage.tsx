import { lazy, Suspense, useCallback, useMemo } from 'react'
import type { NarrationLine } from '../../engine/narrate/narrateTrace'
import type { Event } from '../../engine/trace/events'
import type { WorldState } from '../../engine/trace/world'
import { isBreakpointStep, nextBreakpointStep, prevBreakpointStep } from '../../engine/trace/breakpoints'
import { usePlayback } from '../timeline/usePlayback'
import { useKeyboardTransport } from '../timeline/useKeyboardTransport'
import { LeftoverNotice } from './LeftoverNotice'
import { ThreadPools } from './ThreadPools'
import type { ReactFlowGraph } from './toReactFlow'
import './graph-stage.css'

// @xyflow/react (+ its d3 internals) is ~350KB on its own — split into its own
// chunk via lazy() instead of a static import, same reasoning as elkLayout.ts's
// dynamic import of elkjs. The Suspense fallback below covers the one tick
// this takes; it's already downloading by the time layout/toReactFlow finish.
const GraphCanvas = lazy(() => import('./GraphCanvas').then(m => ({ default: m.GraphCanvas })))

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
  graph, narration, stepIndex, setStep, total, events, source, world, breakpoints,
}: {
  graph: ReactFlowGraph
  narration: readonly NarrationLine[]
  stepIndex: number
  setStep: (n: number) => void
  total: number
  events: readonly Event[]
  source: string
  world: WorldState
  /** 1-based lines to stop on. Empty = the run controls behave exactly as before. */
  breakpoints: readonly number[]
}) {
  const reached = useMemo(
    () => narration.filter(l => l.index < stepIndex),
    [narration, stepIndex],
  )
  const current = reached.length > 0 ? reached[reached.length - 1]! : null
  const totalSteps = narration.length
  const currentStep = reached.length

  const bpLines = useMemo(() => new Set(breakpoints), [breakpoints])

  /**
   * The next stop: the next narrated step, unless a breakpoint comes first.
   *
   * Honest scope, measured: with today's `narrate()`, EVERY event that carries
   * a `srcLine` is also a narration milestone, so this clamp never currently
   * changes the result — removing it leaves the whole suite green. What
   * actually stops playback on a breakpoint is `stopAt` below.
   *
   * It stays because that coincidence is a property of the current
   * `narrate()`, not a law. `stopAt` is only ever asked about a step the loop
   * LANDS on; the day an event type carries a line without earning a sentence
   * (exactly what would happen if `THREAD_STATE` ever gained one), playback
   * would jump clean over the breakpoint and silently stop stopping. This
   * clamp is what makes landing on it guaranteed rather than lucky.
   *
   * Used by the play loop AND by the ▶| button, so stepping by hand stops in
   * the same places playing does.
   */
  const nextStep = useCallback(
    (cur: number) => {
      const next = narration.find(l => l.index >= cur)
      const narrated = next ? next.index + 1 : total
      const bp = nextBreakpointStep(events, cur, bpLines)
      return bp !== null && bp < narrated ? bp : narrated
    },
    [narration, total, events, bpLines],
  )

  const stopAt = useCallback(
    (step: number) => isBreakpointStep(events, step, bpLines), [events, bpLines])

  const { playing, play, pause } = usePlayback(stepIndex, setStep, total, nextStep, stopAt)

  const stepBack = useCallback(() => {
    const before = narration.filter(l => l.index < stepIndex - 1)
    setStep(before.length > 0 ? before[before.length - 1]!.index + 1 : 0)
  }, [narration, stepIndex, setStep])

  const stepForward = useCallback(() => setStep(nextStep(stepIndex)), [nextStep, setStep, stepIndex])

  const empty = total === 0

  const nextBp = nextBreakpointStep(events, stepIndex, bpLines)
  const prevBp = prevBreakpointStep(events, stepIndex, bpLines)

  // `stopAt` is only ever asked about a step the loop has just MOVED to, so
  // "stop when you ARRIVE at a breakpoint" falls out for free — pressing Play
  // while already standing on one simply plays on. No extra bookkeeping.
  const toStart = useCallback(() => setStep(0), [setStep])
  const toEnd = useCallback(() => setStep(total), [setStep, total])

  // Same four actions the buttons run — one implementation, two ways in, so a
  // shortcut can never do something subtly different from its button.
  useKeyboardTransport(
    useMemo(
      () => ({ play, pause, playing, stepBack, stepForward, toStart, toEnd }),
      [play, pause, playing, stepBack, stepForward, toStart, toEnd],
    ),
    !empty,
  )

  const runToBreakpoint = useCallback(() => {
    if (nextBp !== null) setStep(nextBp)
  }, [nextBp, setStep])

  const backToBreakpoint = useCallback(() => {
    if (prevBp !== null) setStep(prevBp)
  }, [prevBp, setStep])

  return (
    <div className="k-stage">
      <LeftoverNotice events={events} source={source} />
      <div className="k-stage__canvas">
        <Suspense fallback={null}>
          <GraphCanvas nodes={graph.nodes} edges={graph.edges} />
        </Suspense>
      </div>
      {/* Under the canvas, above the caption: it answers a DIFFERENT question
          from the graph ("which thread is this on right now") rather than
          another aspect of the same one, so it gets its own band instead of
          more badges crowding the nodes. */}
      <ThreadPools world={world} />

      <div className="k-stage__bar">
        <div className="k-stage__controls">
          <button
            type="button" onClick={toStart}
            disabled={empty || stepIndex === 0}
            aria-label="Back to start" title="Back to start (Home)"
          >⏮</button>
          <button
            type="button" onClick={stepBack}
            disabled={empty || stepIndex === 0} aria-label="Previous step"
          >|◀</button>
          <button
            type="button" className="k-stage__play"
            onClick={playing ? pause : play} disabled={empty}
            // Name is DIFFERENT from the play button in the debug panel,
            // because the two buttons step in different units: here it's a
            // narrated step, there it's a single event. Same name and neither
            // a screen reader nor a test can tell them apart.
            aria-pressed={playing}
            aria-label={playing ? 'Pause step playback' : 'Play by step'}
            title={playing ? 'Pause (Space)' : 'Play by step (Space)'}
          >{playing ? '⏸' : '▶'}</button>
          <button
            type="button" onClick={stepForward}
            disabled={empty || stepIndex >= total}
            aria-label="Next step" title="Next step (→)"
          >▶|</button>
          {/* The counterpart to ⏮, which existed on its own until now: getting
              to the end meant holding the step button or dragging the scrubber
              in the debug panel — and the end state is the one people most
              often want to see first. */}
          <button
            type="button" onClick={toEnd}
            disabled={empty || stepIndex >= total}
            aria-label="Jump to end" title="Jump to end (End)"
          >⏭</button>
          {/* Only present once a breakpoint exists: a control that can never
              do anything is worse than no control — it invites a click and
              answers with silence. */}
          {breakpoints.length > 0 && (
            <>
              <button
                type="button" className="k-stage__bp"
                onClick={backToBreakpoint} disabled={prevBp === null}
                aria-label="Back to previous breakpoint"
                title={prevBp === null
                  ? 'No breakpoint hit before this point'
                  : 'Jump back to the previous breakpoint hit'}
              >◀◆</button>
              <button
                type="button" className="k-stage__bp"
                onClick={runToBreakpoint} disabled={nextBp === null}
                aria-label="Run to next breakpoint"
                title={nextBp === null
                  ? 'No breakpoint is hit after this point'
                  : 'Run until the next breakpoint hit'}
              >◆▶</button>
            </>
          )}
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
      </div>
    </div>
  )
}
