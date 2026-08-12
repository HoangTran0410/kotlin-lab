import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { openDebug } from './helpers/openDebug'

/**
 * "Wiring" test following the lesson of Task 9/13/16: usePlayback.ts is
 * tested thoroughly at the hook layer (playback.test.tsx) using a homemade
 * fake store — it can't catch bugs like "App forgot to mount
 * PlaybackControls" or "App passed the wrong store's setStep by mistake".
 * This test assembles the real <App />, clicks real DOM buttons, and confirms
 * the real Zustand store (useLabStore) moves along with fake time.
 */
describe('wiring App -> PlaybackControls — real play/pause drives the real store', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("clicking Play advances the store's real stepIndex over time; clicking Pause stops it", async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    // useLayout (Task 15) runs ELK asynchronously through a real Promise —
    // Promises aren't intercepted by @sinonjs/fake-timers (only macrotask
    // timers are faked), so its `.then()` resolves as a normal MICROTASK.
    // SYNCHRONOUS `act(fn)` doesn't wait for microtasks to drain before
    // returning — must `await act(async () => {...})` (see the
    // advanceTimersByTime calls below) so React waits out the async
    // continuation before considering act() done, otherwise useLayout's
    // setState arrives late OUTSIDE act() and React warns "not wrapped in
    // act".
    await act(async () => {})

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture supervisor needs enough events for the test to be meaningful').toBeGreaterThan(3)

    const playBtn = screen.getByRole('button', { name: 'Play' })
    fireEvent.click(playBtn)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(1040) }) // default speed 1×, plus one extra rAF frame
    expect(useLabStore.getState().stepIndex).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(useLabStore.getState().stepIndex).toBe(1) // stays put after pausing
  })

  it("dragging the Timeline while playing stops playback automatically — no fighting with the user's finger", async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    // useLayout (Task 15) runs ELK asynchronously through a real Promise —
    // Promises aren't intercepted by @sinonjs/fake-timers (only macrotask
    // timers are faked), so its `.then()` resolves as a normal MICROTASK.
    // SYNCHRONOUS `act(fn)` doesn't wait for microtasks to drain before
    // returning — must `await act(async () => {...})` (see the
    // advanceTimersByTime calls below) so React waits out the async
    // continuation before considering act() done, otherwise useLayout's
    // setState arrives late OUTSIDE act() and React warns "not wrapped in
    // act".
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    const range = screen.getByLabelText('Timeline scrubber') as HTMLInputElement
    fireEvent.change(range, { target: { value: '20' } })
    expect(useLabStore.getState().stepIndex).toBe(20)

    // The button must go back to "Play" — playback stopped because the user dragged.
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(useLabStore.getState().stepIndex).toBe(20) // doesn't keep auto-advancing
  })

  it("manual Step forward/back calls the real store's setStep correctly", async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    // useLayout (Task 15) runs ELK asynchronously through a real Promise —
    // Promises aren't intercepted by @sinonjs/fake-timers (only macrotask
    // timers are faked), so its `.then()` resolves as a normal MICROTASK.
    // SYNCHRONOUS `act(fn)` doesn't wait for microtasks to drain before
    // returning — must `await act(async () => {...})` (see the
    // advanceTimersByTime calls below) so React waits out the async
    // continuation before considering act() done, otherwise useLayout's
    // setState arrives late OUTSIDE act() and React warns "not wrapped in
    // act".
    await act(async () => {})
    act(() => { useLabStore.getState().setStep(5) })

    fireEvent.click(screen.getByRole('button', { name: 'Step forward' }))
    expect(useLabStore.getState().stepIndex).toBe(6)

    fireEvent.click(screen.getByRole('button', { name: 'Step back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Step back' }))
    expect(useLabStore.getState().stepIndex).toBe(4)
  })
})
