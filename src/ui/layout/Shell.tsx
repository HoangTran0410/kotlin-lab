import type { ReactNode } from 'react'
import { SimulationNotice } from '../common/SimulationNotice'
import { Splitter } from './Splitter'
import { MAX_LEFT, MAX_RIGHT, MIN_LEFT, MIN_RIGHT, usePanelWidths } from './usePanelWidths'
import { REGION_LABEL, REGION_TITLE, REGIONS, usePanelVisibility } from './usePanelVisibility'
import './shell.css'

/**
 * Three regions around the graph, each shown or hidden on its OWN.
 *
 * There used to be ONE "Deep debug" button that opened the right column and
 * the bottom timeline together. Those two answer different questions — the
 * timeline is for FOLLOWING along, the console is for DIGGING IN — so wanting
 * the timeline without the console is the normal case, not an edge case, and
 * one button could not express it.
 *
 * The toggles live in the HEADER, not on each panel's own edge: a hidden panel
 * has no edge left to click, so per-panel controls can hide themselves and
 * leave no way back.
 *
 * The graph has no toggle. It is the thing everything else sits around; hiding
 * it would only produce a state with nothing to look at.
 *
 * Defaults are exactly what the single toggle used to produce — editor open,
 * the other two closed — so nothing moves for someone who liked the old layout.
 */
export function Shell({ nav, editor, graph, timeline, side }: {
  nav: ReactNode; editor: ReactNode; graph: ReactNode
  timeline: ReactNode; side: ReactNode
}) {
  const { left, right, setLeft, setRight, reset } = usePanelWidths()
  const { show, toggle } = usePanelVisibility()

  return (
    <div className="shell">
      <header className="shell__head">
        <h1>Kotlin Coroutines Lab</h1>
        {nav}
        <div className="shell__panels" role="group" aria-label="Show or hide panels">
          {REGIONS.map(r => (
            <button
              key={r}
              type="button"
              className={show[r] ? 'shell__panel shell__panel--on' : 'shell__panel'}
              onClick={() => toggle(r)}
              aria-pressed={show[r]}
              title={REGION_TITLE[r]}
            >
              {REGION_LABEL[r]}
            </button>
          ))}
        </div>
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
        // doesn't have to be rebuilt as a string in TSX. Same reason the column
        // count is SELECTED by data attributes rather than assembled here —
        // see the four `.shell__main[data-left][data-right]` rules.
        style={{
          '--w-left': `${left}px`,
          '--w-right': `${right}px`,
        } as React.CSSProperties}
        data-left={show.left ? 'on' : 'off'}
        data-right={show.right ? 'on' : 'off'}
      >
        {show.left && (
          <>
            <div className="shell__left">{editor}</div>
            <Splitter label="Code column width" width={left} setWidth={setLeft} min={MIN_LEFT} max={MAX_LEFT} />
          </>
        )}
        <div className="shell__center">{graph}</div>
        {show.right && (
          <>
            <Splitter
              label="Debug column width" width={right} setWidth={setRight}
              min={MIN_RIGHT} max={MAX_RIGHT} invert
            />
            <div className="shell__right">{side}</div>
          </>
        )}
      </div>
      {show.bottom && <footer className="shell__foot">{timeline}</footer>}
    </div>
  )
}
