import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { openDebug } from './helpers/openDebug'

/**
 * "Wiring" test following the lesson of Task 9/13 (see
 * current-line-wiring.test.tsx, graph-canvas.test.tsx): a test that builds
 * Timeline.tsx DIRECTLY (timeline.test.tsx) can't catch bugs like "App forgot
 * to pass the real compiled.events/stepIndex/setStep into Timeline" or "the
 * timeline panel is still the old placeholder text". Only here, with a
 * real assembled <App />, does dragging the DOM actually drive the real
 * store.
 */
describe("wiring App -> Timeline — dragging the real DOM changes the store's real stepIndex, both directions", () => {
  it('dragging the range input to 10 then back to 3 changes store.stepIndex correctly, keeping node positions fixed', async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)
    openDebug()

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture supervisor needs events for the test to be meaningful').toBeGreaterThan(10)

    const range = screen.getByLabelText('Timeline scrubber') as HTMLInputElement
    expect(range.max).toBe(String(total))

    // useLayout (Task 15) runs ELK inside a useEffect; the result comes back
    // through ONE microtask (`layoutGraph(...).then(...)`) that never gets
    // flushed just because render()/fireEvent already ran. Measured in a
    // previous round (fix round 1): drop this `waitFor` and
    // `.react-flow__node` querySelectorAll returns EMPTY at both snapshot
    // points below, and `expect(positionsAgain).toEqual(positionsAt10)` goes
    // green because it's comparing `[] === []` — testing nothing at all.
    // Must wait for real nodes to appear before capturing a reference
    // position.
    await waitFor(() => {
      expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0)
    })

    fireEvent.change(range, { target: { value: '10' } })
    expect(useLabStore.getState().stepIndex).toBe(10)

    const positionsAt10 = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform] as const)
    // Sanity check: if this array is empty, the comparison below goes green
    // without testing anything (this actually happened before, see the
    // `waitFor` note above). Force real nodes to exist before trusting any
    // comparison based on this array.
    expect(positionsAt10.length, 'must capture REAL node positions, not an empty array').toBeGreaterThan(0)

    // Drag BACKWARD — this is exactly the feature this whole milestone exists to allow.
    fireEvent.change(range, { target: { value: '3' } })
    expect(useLabStore.getState().stepIndex).toBe(3)

    const positionsAt3 = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform] as const)
    expect(positionsAt3.length, 'fixture: needs at least 1 node born by step 3').toBeGreaterThan(0)

    // A REAL anti-jitter invariant — different from the drag-to-then-back-to-
    // the-SAME-step check above (which is only sensitive to bugs like "App
    // forgot to rewire", NOT sensitive to a bug like "position recomputed per
    // step's subgraph": world.jobs.size at step 3 and step 10 differ, but
    // both are still internally self-consistent, so a step-compared-with-
    // itself check would never go red under that bug — measured directly by
    // Break 3 in task-20-report.md, fix round 1). A node born at BOTH steps
    // (here: root, born earliest) must carry the SAME coordinates no matter
    // which step it's viewed from — layout is fixed once for the whole trace,
    // not recomputed for whichever set of nodes exists at the step being
    // viewed.
    const at10ById = new Map(positionsAt10)
    for (const [id, transform] of positionsAt3) {
      expect(at10ById.get(id), `node ${id}: coordinates at step 3 must match step 10`).toBe(transform)
    }

    fireEvent.change(range, { target: { value: '10' } })
    expect(useLabStore.getState().stepIndex).toBe(10)
    const positionsAgain = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform])
    expect(positionsAgain.length, 'must capture REAL node positions, not an empty array').toBeGreaterThan(0)

    // Anti-jitter invariant (Task 11/12): returning to the SAME step must
    // give identical node positions (computed by fixed layout, not by
    // step-by-step world state).
    expect(positionsAgain).toEqual(positionsAt10)
  })

  it('the ← key on the real App steps back exactly one step through the real store', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    act(() => { useLabStore.getState().setStep(5) })

    const range = screen.getByLabelText('Timeline scrubber') as HTMLInputElement
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    expect(useLabStore.getState().stepIndex).toBe(4)
  })
})
