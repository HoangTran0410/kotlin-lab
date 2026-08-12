import type { ReactNode } from 'react'
import { SimulationNotice } from '../common/SimulationNotice'
import { Splitter } from './Splitter'
import { MAX_LEFT, MAX_RIGHT, MIN_LEFT, MIN_RIGHT, usePanelWidths } from './usePanelWidths'
import { MOBILE_REGION_LABEL, MOBILE_REGION_TITLE, REGION_LABEL, REGION_TITLE, REGIONS, usePanelVisibility } from './usePanelVisibility'
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
export function Shell({ nav, editor, graph, timeline, side, isEmpty, onStartLesson }: {
  nav: ReactNode; editor: ReactNode; graph: ReactNode
  timeline: ReactNode; side: ReactNode
  isEmpty?: boolean; onStartLesson?: () => void
}) {
  const { left, right, setLeft, setRight, reset } = usePanelWidths()
  const { show, toggle, isCompact, mobileRegion } = usePanelVisibility()
  const labels = isCompact ? MOBILE_REGION_LABEL : REGION_LABEL
  const titles = isCompact ? MOBILE_REGION_TITLE : REGION_TITLE
  const panelIsOn = (region: typeof REGIONS[number]): boolean => isCompact ? mobileRegion === region : show[region]

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
              className={panelIsOn(r) ? 'shell__panel shell__panel--on' : 'shell__panel'}
              onClick={() => toggle(r)}
              aria-pressed={panelIsOn(r)}
              title={titles[r]}
            >
              {labels[r]}
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
        data-mobile-active={mobileRegion}
      >
        {(show.left || isCompact) && (
          <>
            <div className="shell__left" style={{ position: 'relative' }}>
              {editor}
              {isCompact && isEmpty && onStartLesson && (
                <div className="shell__empty shell__empty--code">
                  <p>See a coroutine run before writing your own.</p>
                  <button type="button" onClick={onStartLesson}>Start lesson 1</button>
                </div>
              )}
            </div>
            <Splitter label="Code column width" width={left} setWidth={setLeft} min={MIN_LEFT} max={MAX_LEFT} />
          </>
        )}
        <div className="shell__center">
          {graph}
          {!isCompact && isEmpty && onStartLesson && (
            <div className="shell__empty">
              <p>See a coroutine run before writing your own.</p>
              <button type="button" onClick={onStartLesson}>Start lesson 1</button>
            </div>
          )}
        </div>
        {(show.right || isCompact) && (
          <>
            <Splitter
              label="Debug column width" width={right} setWidth={setRight}
              min={MIN_RIGHT} max={MAX_RIGHT} invert
            />
            <div className="shell__right">{side}</div>
          </>
        )}
      </div>
      {!isCompact && show.bottom && <footer className="shell__foot">{timeline}</footer>}
    </div>
  )
}
