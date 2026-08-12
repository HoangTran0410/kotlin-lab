import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { highlightedLine } from './support/highlightedLine'

/**
 * "Wiring" (Step 3 of brief task 9) has no automated test in the brief — just
 * a manual `npm run dev`, open a lesson, and "drag the timeline". No timeline
 * slider had been built as of this task yet (the timeline panel is still a
 * placeholder in App.tsx), so the test here drives the real store through
 * `setStep` — the exact mechanism a timeline scrubber in a later task will
 * call.
 *
 * Split into its own file (not part of current-line.test.ts) because the
 * brief explicitly says that file is a "pure test, no React rendering
 * needed" — while this test NEEDS to render <App />.
 *
 * Why this test was added even though the brief doesn't ask for it: task 8
 * (debounce) once slipped through the net EXACTLY BECAUSE every test at the
 * time only rendered CodeEditor directly, never through App — the behavior
 * "the currentLine prop ACTUALLY flows from the store down to EditorView"
 * only exists once App and CodeEditor are wired together. currentLine.test.ts
 * (Step 2) can't catch bugs like "App forgot to read selectCurrentLine" or
 * "App forgot to pass the currentLine prop" — both would leave the
 * currentLineField working correctly when called directly, so those tests
 * would still pass.
 */
describe("wiring App -> CodeEditor — highlight follows the store's real stepIndex", () => {
  it('dragging stepIndex through the store moves the highlighted line in EditorView along with it', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)
    const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('EditorView not found in the DOM')

    // Measured before writing the threshold (tests/engine/trace-srcline.test.ts
    // uses the same 'supervisor' source; re-measured by hand here): this
    // lesson's trace has 64 events, passing through exactly 3 different lines
    // (3, 4, 5).
    const n = useLabStore.getState().compiled.events.length
    expect(n, 'fixture supervisor must have events to step through for the test to be meaningful').toBeGreaterThan(0)

    const seen = new Set<number | null>()
    for (let i = 0; i <= n; i++) {
      act(() => { useLabStore.getState().setStep(i) })
      seen.add(highlightedLine(view.state))
    }

    const distinctLines = [...seen].filter((l): l is number => l !== null)
    expect(new Set(distinctLines).size, 'must see more than 1 line when scrubbing through the whole trace').toBeGreaterThan(1)
    // Derived from the REAL SOURCE, not hardcoded numbers: adding one
    // `import` line at the top of the lesson would throw off every hand-
    // copied line number, and the test would fail for a reason that has
    // nothing to do with what it's locking down (wiring highlight <->
    // stepIndex).
    const src = lessonSource('supervisor')!.split('\n')
    const launchLines = src
      .map((l, i) => (l.includes('launch {') ? i + 1 : -1))
      .filter(n => n > 0)
    expect(launchLines.length, 'lesson supervisor must have 3 launch lines').toBe(3)
    expect(new Set(distinctLines)).toEqual(new Set(launchLines))
  })

  it('step 0, with no events yet, has nothing highlighted', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)
    const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('EditorView not found in the DOM')
    expect(highlightedLine(view.state)).toBeNull()
  })
})
