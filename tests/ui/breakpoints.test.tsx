import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { foldTrace } from '../../src/engine/trace/world'

const SRC = `import kotlinx.coroutines.*

fun main() = runBlocking {
    repeat(3) {
        println("tick")
    }
    val job = launch { delay(50) }
    job.join()
}
`

const load = (src: string): void => { act(() => { useLabStore.getState().loadSource(src) }) }
const setBp = (...lines: number[]): void => {
  act(() => { for (const l of lines) useLabStore.getState().toggleBreakpoint(l) })
}
const runToBp = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Run to next breakpoint' }))
}
const currentLine = (): number | null =>
  foldTrace(useLabStore.getState().compiled.events, useLabStore.getState().stepIndex).srcLine

/** The gutter dots CodeMirror is actually drawing right now. */
const dots = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.cm-bp-dot')]

describe('breakpoints in the editor', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null, breakpoints: [] })
  })

  it('no run controls at all until a breakpoint exists', () => {
    // A control that can never do anything is worse than no control: it
    // invites a click and answers with silence.
    render(<App />)
    load(SRC)
    expect(screen.queryByRole('button', { name: 'Run to next breakpoint' })).toBeNull()
    setBp(5)
    expect(screen.getByRole('button', { name: 'Run to next breakpoint' })).toBeInTheDocument()
  })

  it('running stops exactly ON the marked line', () => {
    render(<App />)
    load(SRC)
    setBp(5)
    expect(currentLine()).not.toBe(5)
    runToBp()
    expect(currentLine(), 'stopped on the wrong line').toBe(5)
  })

  it('a line inside a loop stops once per pass, then reports nothing ahead', () => {
    render(<App />)
    load(SRC)
    setBp(5)
    const stops: number[] = []
    for (let i = 0; i < 3; i++) {
      runToBp()
      expect(currentLine()).toBe(5)
      stops.push(useLabStore.getState().stepIndex)
    }
    expect(new Set(stops).size, 'the same stop was reported three times').toBe(3)
    // Fourth press: nothing left ahead, so the button is disabled rather than
    // silently doing nothing.
    expect(screen.getByRole('button', { name: 'Run to next breakpoint' })).toBeDisabled()
  })

  it('goes backwards as well — the trace is a finished record', () => {
    render(<App />)
    load(SRC)
    setBp(5)
    runToBp(); runToBp()
    const forward = useLabStore.getState().stepIndex
    fireEvent.click(screen.getByRole('button', { name: 'Back to previous breakpoint' }))
    expect(useLabStore.getState().stepIndex).toBeLessThan(forward)
    expect(currentLine()).toBe(5)
  })

  it('the gutter draws a dot per breakpoint, and clicking the store toggles it off', () => {
    render(<App />)
    load(SRC)
    setBp(5, 7)
    expect(dots()).toHaveLength(2)
    setBp(5)
    expect(dots()).toHaveLength(1)
  })

  it('a breakpoint on a line that never runs is drawn as unreachable', () => {
    // Without this, setting a breakpoint on a comment looks identical to a
    // working one, and "I pressed run and nothing happened" reads as a broken
    // tool instead of the real answer: that line never executes.
    render(<App />)
    load(SRC)
    setBp(1) // the import line
    expect(dots()).toHaveLength(1)
    expect(dots()[0]!.className).toContain('cm-bp-dot--unreachable')

    setBp(1, 5)
    const live = dots().filter(d => !d.className.includes('unreachable'))
    expect(live, 'the executable line was also marked unreachable').toHaveLength(1)
  })

  it('a real mousedown on the gutter reaches the store', () => {
    // The wiring that testing the store alone can never reach: CodeMirror's
    // gutter click has to arrive at the Zustand action carrying the right line
    // number.
    //
    // What this case does NOT assert, and why: WHICH line the click lands on.
    // jsdom has no layout, so the synthetic event carries clientY = 0 and
    // CodeMirror resolves the position to line 1 no matter which element is
    // clicked — measured (clicking line 5's element produced line 1). Pinning
    // a line number here would be pinning a jsdom artifact.
    //
    // What it does prove is the part no store-level test can reach: a real
    // mousedown on the gutter reaches the Zustand action at all.
    render(<App />)
    load(SRC)
    setBp(5)
    const el = [...document.querySelectorAll<HTMLElement>('.cm-bp-gutter .cm-gutterElement')]
      .find(e => e.querySelector('.cm-bp-dot') !== null)
    expect(el, 'the gutter rendered no element for the breakpoint line').toBeTruthy()

    const before = [...useLabStore.getState().breakpoints]
    act(() => { fireEvent.mouseDown(el!) })
    expect(useLabStore.getState().breakpoints, 'the gutter click never reached the store')
      .not.toEqual(before)
  })

  it('pressing Play while STANDING on a breakpoint keeps playing', () => {
    // Otherwise the auto-pause would fire on the very next frame and the play
    // button would look broken. "Stop when you ARRIVE at a breakpoint" is not
    // the same rule as "stop whenever you are standing on one", and only the
    // first one is usable.
    render(<App />)
    load(SRC)
    setBp(5)
    runToBp()

    const play = screen.getByRole('button', { name: 'Play by step' })
    act(() => { fireEvent.click(play) })
    expect(
      screen.getByRole('button', { name: /Play by step|Pause step playback/ })
        .getAttribute('aria-pressed'),
      'playback stopped itself immediately on the breakpoint it was already on',
    ).toBe('true')
  })

  it('playing STOPS on its own when it reaches a breakpoint', async () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      load(SRC)
      setBp(7) // the `launch` line, well past the start
      const play = screen.getByRole('button', { name: 'Play by step' })
      await act(async () => { fireEvent.click(play) })
      await act(async () => { vi.advanceTimersByTime(30_000) })

      expect(
        screen.getByRole('button', { name: /Play by step|Pause step playback/ })
          .getAttribute('aria-pressed'),
        'playback ran past the breakpoint without stopping',
      ).toBe('false')
      expect(currentLine(), 'it stopped, but not on the breakpoint line').toBe(7)
    } finally {
      vi.useRealTimers()
    }
  })

  it('breakpoints survive an edit but are cleared by opening another program', () => {
    // Line 7 of the previous lesson has nothing to do with line 7 of this one.
    // While editing, the lines being worked on are exactly the ones still
    // wanted.
    render(<App />)
    load(SRC)
    setBp(5)
    act(() => { useLabStore.getState().setSource(SRC + '\n') })
    expect(useLabStore.getState().breakpoints, 'an edit wiped the breakpoints').toEqual([5])

    act(() => { useLabStore.getState().loadLesson('suspend') })
    expect(useLabStore.getState().breakpoints, 'opening a new program kept stale breakpoints').toEqual([])
  })
})
