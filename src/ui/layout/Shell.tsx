import type { ReactNode } from 'react'
import { SimulationNotice } from '../common/SimulationNotice'
import { Splitter } from './Splitter'
import { MAX_LEFT, MAX_RIGHT, MIN_LEFT, MIN_RIGHT, usePanelWidths } from './usePanelWidths'
import './shell.css'

/**
 * `debugOpen` decides whether the right column (console + diagnostics + full
 * narration) and the bottom per-event timeline bar are shown.
 *
 * Defaults to OFF. The graph already carries the explanation for the step
 * being viewed, a scrub control, and `println` right on the node — enough to
 * follow along without looking at four corners of the screen. The debug panel
 * is where you go to dig deeper (event by event, full console, narration
 * history), not somewhere you're forced to glance at to understand what's
 * happening.
 */
export function Shell({ nav, editor, graph, timeline, side, debugOpen }: {
  nav: ReactNode; editor: ReactNode; graph: ReactNode
  timeline: ReactNode; side: ReactNode; debugOpen: boolean
}) {
  const { left, right, setLeft, setRight, reset } = usePanelWidths()

  return (
    <div className="shell">
      <header className="shell__head">
        <h1>Kotlin Coroutines Lab</h1>
        {nav}
        <button type="button" className="shell__reset" onClick={reset} title="Reset column widths to their defaults">
          Reset layout
        </button>
      </header>
      <SimulationNotice />
      <div
        className="shell__main"
        // Widths go through a CSS variable instead of writing grid-template
        // straight into style: this keeps the grid definition in exactly one
        // place in the CSS, and the `1fr` expression for the middle column
        // doesn't have to be rebuilt as a string in TSX.
        style={{
          '--w-left': `${left}px`,
          '--w-right': `${right}px`,
        } as React.CSSProperties}
        data-debug={debugOpen ? 'open' : 'closed'}
      >
        <div className="shell__left">{editor}</div>
        <Splitter label="Code column width" width={left} setWidth={setLeft} min={MIN_LEFT} max={MAX_LEFT} />
        <div className="shell__center">{graph}</div>
        {debugOpen && (
          <>
            <Splitter
              label="Debug column width" width={right} setWidth={setRight}
              min={MIN_RIGHT} max={MAX_RIGHT} invert
            />
            <div className="shell__right">{side}</div>
          </>
        )}
      </div>
      {debugOpen && <footer className="shell__foot">{timeline}</footer>}
    </div>
  )
}
