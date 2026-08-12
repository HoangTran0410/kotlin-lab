import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { openDebug } from './helpers/openDebug'

/**
 * REPLACES PLAYWRIGHT (Task 20 Step 3) — there's no real browser in this
 * environment (confirmed from earlier tasks, see task-20-report.md). The
 * brief's four `e2e/scrub.spec.ts` assertions need a REAL browser: they
 * measure `boundingBox` using Chromium's real layout engine, while jsdom here
 * has NO layout engine — `getBoundingClientRect` always returns 0 (see the
 * original note in tests/ui/setup.ts and tests/ui/graph-canvas.test.tsx).
 *
 * This file gets as close as possible to those four assertions WITHIN jsdom:
 * mounts a REAL `<App/>` (no store mock, no ReactFlow mock), drives the store
 * through the exact API that LessonNav/Timeline actually call, and reads
 * `style.transform` — the one property React Flow uses to position nodes
 * (see GraphCanvas.tsx, locked down by graph-canvas.test.tsx) — in place of
 * `boundingBox`.
 *
 * What CANNOT be proven here, and has to wait for a real browser:
 *   - a real `boundingBox` (post-layout size with real CSS, affected by font,
 *     zoom, whether ELK's width/height actually matches the DOM).
 *   - any CSS/animation effect that only runs through a real compositor.
 *   - real pointer interaction (mouse dragging) instead of `fireEvent.change`.
 */
afterEach(() => {
  cleanup()
  useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
})

/**
 * `useLayout` (Task 15) runs ELK inside `useEffect`, and the result comes
 * back through ONE microtask (`layoutGraph(...).then(...)`) — never flushed
 * while the test function's body is still running synchronously, even after
 * `render()`/`fireEvent`. Measured with this very file: remove the `waitFor`
 * below and both `it`s go red with "0 nodes" — `toReactFlow` skips EVERY node
 * while `layout` is still an empty Map (see toReactFlow.ts: `if (!box)
 * continue`), so ReactFlow mounts 0 nodes and every position comparison after
 * that goes green on an EMPTY SHELL (array `[]` matching `[]`). ELK must
 * finish BEFORE capturing the reference position, otherwise this test proves
 * nothing at all — a silent false green.
 */
async function loadAndRender(id: string): Promise<number> {
  useLabStore.getState().setSource(lessonSource(id)!)
  render(<App />)
  openDebug()
  const total = useLabStore.getState().compiled.events.length
  expect(total, `fixture ${id} needs events`).toBeGreaterThan(0)
  await waitFor(() => {
    expect(document.body.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0)
  })
  return total
}

function nodePositions(container: HTMLElement): Map<string, string> {
  const map = new Map<string, string>()
  for (const el of container.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const id = el.dataset.id
    if (id !== undefined) map.set(id, el.style.transform)
  }
  return map
}

/** JobNode's (leaf) borderTopColor encodes state — see JobNode.tsx/nodeStyle.ts. */
function jobBorderColors(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="job-node"]')].map(
    el => el.style.borderTopColor,
  )
}

describe('DOM SMOKE (jsdom) — stands in for Playwright, real App + real store', () => {
  // 'A done' / 'C done' below are println output from the
  // 'supervisor' lesson fixture (src/lessons/*), owned and translated
  // independently by the lessons agent — outside this agent's scope. Left
  // as-is; integrator must update these two literals to match once that
  // translation lands.
  it('supervisor: graph renders >=5 nodes, console has 2 lines at the end, empty when scrubbed back to 0, node positions invariant while scrubbing', async () => {
    const total = await loadAndRender('supervisor')

    const container = document.body
    const nodesAtMount = container.querySelectorAll('.react-flow__node')
    expect(nodesAtMount.length, 'supervisor needs >=5 nodes on the graph').toBeGreaterThanOrEqual(5)

    act(() => { useLabStore.getState().setStep(total) })
    const region = screen.getByRole('region', { name: 'Console' })
    expect(within(region).getAllByText(/^t=/)).toHaveLength(2)
    expect(within(region).getByText('A done')).toBeInTheDocument()
    expect(within(region).getByText('C done')).toBeInTheDocument()

    // Exactly two launch nodes Completed, one launch node Cancelled — visible
    // through the real border color on the real DOM, not just in raw data.
    const colorsAtEnd = jobBorderColors(container)
    expect(colorsAtEnd.filter(c => c === 'var(--state-completed)')).toHaveLength(2)
    expect(colorsAtEnd.filter(c => c === 'var(--state-cancelled)')).toHaveLength(1)

    const ref = nodePositions(container)
    expect(ref.size, 'must be able to capture node positions at the end of the trace').toBeGreaterThanOrEqual(5)

    // Scrub THROUGH EVERY STEP forward then backward (not just two sample
    // points) — node position (style.transform, set directly by React Flow
    // from the fixed layout) must be identical at EVERY step, not just at the
    // final one.
    for (let n = 0; n <= total; n++) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `supervisor forward @${n} node ${id}`).toBe(transform)
    }
    for (let n = total; n >= 0; n--) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `supervisor backward @${n} node ${id}`).toBe(transform)
    }

    // Scrub all the way back to 0: console must be empty again (guarding
    // against jitter doesn't mean "frozen forever" — DISPLAYED data must
    // still change correctly with the step).
    act(() => { useLabStore.getState().setStep(0) })
    expect(within(region).getByText('No output yet.')).toBeInTheDocument()

    // Back to the end: node positions must match the original reference — no
    // jitter after a full scrub cycle.
    act(() => { useLabStore.getState().setStep(total) })
    const positionsAgain = nodePositions(container)
    for (const [id, transform] of ref) expect(positionsAgain.get(id), `supervisor end-of-cycle node ${id}`).toBe(transform)
  })

  it('normalfail: console has 0 lines at the end, all three launches Cancelled, node positions invariant while scrubbing', async () => {
    const total = await loadAndRender('normalfail')
    const container = document.body

    act(() => { useLabStore.getState().setStep(total) })
    const region = screen.getByRole('region', { name: 'Console' })
    expect(within(region).getByText('No output yet.')).toBeInTheDocument()

    const colorsAtEnd = jobBorderColors(container)
    expect(colorsAtEnd.length, 'normalfail needs 3 launch nodes').toBe(3)
    expect(colorsAtEnd.every(c => c === 'var(--state-cancelled)'), colorsAtEnd.join(',')).toBe(true)

    const ref = nodePositions(container)
    for (let n = 0; n <= total; n++) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `normalfail forward @${n} node ${id}`).toBe(transform)
    }
    for (let n = total; n >= 0; n--) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `normalfail backward @${n} node ${id}`).toBe(transform)
    }
  })
})
