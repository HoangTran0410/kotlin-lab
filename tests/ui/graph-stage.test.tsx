import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { showPanel } from './helpers/openDebug'
import { lessonSource } from '../../src/lessons/registry'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'

/**
 * Graph stage: narration, scrub-by-STEP buttons, and the debug panel closed
 * by default.
 *
 * These three things exist so learners don't have to look at four corners of
 * the screen. The tests here lock down exactly that — not "does the
 * component render at all".
 */
describe('graph stage — understandable without looking anywhere else', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
  })

  it('debug panel CLOSED by default: no console, no per-event timeline scrubber', () => {
    render(<App />)
    expect(screen.queryByLabelText('Timeline scrubber')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    // But the graph still has to have all of its own tools.
    expect(screen.getByRole('button', { name: 'Play by step' })).toBeInTheDocument()
    expect(screen.getByTestId('stage-caption')).toBeInTheDocument()
  })

  it('each panel toggles on its OWN — timeline without console, and back', () => {
    // The reason the single "Deep debug" button was split: it opened the
    // console and the timeline together, and wanting to follow along on the
    // timeline without the console in the way is the normal case. This asserts
    // the state that used to be unreachable.
    render(<App />)
    expect(screen.queryByLabelText('Timeline scrubber')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.getByLabelText('Timeline scrubber')).toBeInTheDocument()
    expect(screen.queryByTestId('splitter-Debug column width'),
      'turning on the timeline dragged the console along with it').toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Console' }))
    expect(screen.getByTestId('splitter-Debug column width')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeline scrubber'),
      'turning on the console pushed the timeline back out').toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.queryByLabelText('Timeline scrubber')).toBeNull()
    expect(screen.getByTestId('splitter-Debug column width'),
      'turning the timeline off took the console with it').toBeInTheDocument()
  })

  it('narration CHANGES when scrubbing, and both times have real text', () => {
    render(<App />)
    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture must be long enough').toBeGreaterThan(20)

    act(() => useLabStore.getState().setStep(Math.floor(total / 3)))
    const early = screen.getByTestId('stage-caption').textContent ?? ''
    act(() => useLabStore.getState().setStep(total))
    const late = screen.getByTestId('stage-caption').textContent ?? ''

    // Sanity check BEFORE comparing: two empty strings would also be
    // "different" in a meaningless way.
    expect(early.length).toBeGreaterThan(10)
    expect(late.length).toBeGreaterThan(10)
    expect(early).not.toBe(late)
  })

  it('the ▶| button jumps to the next STEP, not +1 event', () => {
    render(<App />)
    const events = useLabStore.getState().compiled.events
    const marks = narrateTrace(events).map(l => l.index)
    // This trace must have at least one spot where two marks are more than 1
    // event apart, otherwise "jump by step" and "+1" coincide and the test
    // can't tell them apart.
    const hasGap = marks.some((v, i) => i > 0 && v - marks[i - 1]! > 1)
    expect(hasGap, 'fixture has no gap between two marks').toBe(true)

    act(() => useLabStore.getState().setStep(0))
    const visited: number[] = []
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
      visited.push(useLabStore.getState().stepIndex)
    }
    // Every click must stop EXACTLY after a mark — i.e. stepIndex - 1 is a mark index.
    for (const s of visited) {
      expect(marks, `stopped at step ${s}, which isn't a mark`).toContain(s - 1)
    }
    expect(new Set(visited).size, 'clicking repeatedly without advancing').toBe(visited.length)
  })

  it("◀ steps back to the previous mark, doesn't get stuck in place", () => {
    render(<App />)
    const total = useLabStore.getState().compiled.events.length
    act(() => useLabStore.getState().setStep(total))
    const before = useLabStore.getState().stepIndex
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    expect(useLabStore.getState().stepIndex).toBeLessThan(before)
  })

  it('println shows up RIGHT ON the node that printed it, not only in the console', async () => {
    render(<App />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="job-node"]').length).toBeGreaterThan(0)
    })
    act(() => useLabStore.getState().setStep(useLabStore.getState().compiled.events.length))

    // Lesson supervisor prints "A done" and "C done" from two different launches.
    await waitFor(() => {
      const nodes = [...document.querySelectorAll('[data-testid="job-node"]')]
      const printed = nodes.map(n => n.textContent ?? '').filter(t => t.includes('done'))
      expect(printed.length, 'no node shows its own println line').toBeGreaterThanOrEqual(2)
    })
    // And the console is still there intact in the debug panel — not a
    // replacement, an addition. Must SEARCH WITHIN the console: "A done" now
    // appears in BOTH the node and the console, and a bare `getByText` would
    // fail red for finding it in multiple places — that fact alone is
    // evidence the feature works.
    fireEvent.click(screen.getByRole('button', { name: 'Console' }))
    // `showPanel` rather than a bare click: the toggle is a switch, so a blind
    // click on an already-on panel turns it OFF.
    showPanel('Console')
    // Scoped to the right column, not `getByText('Console')`: since the panel
    // toggles moved into the header there is a BUTTON labelled "Console" too,
    // and a bare text query now matches both.
    const console_ = document.querySelector('.shell__right')!
    expect(console_.textContent).toContain('A done')
  })
})
