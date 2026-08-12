import { useCallback, useState } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlayback, type Speed } from '../../src/ui/timeline/usePlayback'

/**
 * `usePlayback` calls `setStep` inside its own rAF loop and then expects
 * `stepIndex` (a prop) to reflect that change back on the next render — just
 * like the real App will do through the Zustand store (setStep -> re-render
 * -> new stepIndex). A fake `vi.fn()` doesn't cause a re-render on its own,
 * so we wrap it in a hook with REAL state so a setStep call inside the hook
 * actually loops back around as a new prop — otherwise, "user drags while
 * playing" (test 5) can't be told apart from "playback advances the step on
 * its own" (both would just be a single mock call).
 */
function useControlled(initial: number, max: number) {
  const [stepIndex, setStepIndex] = useState(initial)
  const setStep = useCallback((n: number) => setStepIndex(Math.max(0, Math.min(max, n))), [max])
  const playback = usePlayback(stepIndex, setStep, max)
  return { stepIndex, setStep, ...playback }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/**
 * Fake rAF (vitest/@sinonjs/fake-timers) ticks on a fixed ~16ms frame —
 * measured with a probing test before writing this file. `vi.advanceTimersByTime(N)`
 * only runs the frames that have ALREADY COME DUE within exactly N ms, so the
 * last frame before the N mark always lands a bit short (N doesn't divide
 * evenly by 16). Adding one extra frame's worth of margin guarantees the
 * interval threshold gets crossed, the same way a real UI never promises
 * millisecond-exact timing with rAF (real vsync also drifts by ~16.67ms).
 */
const FRAME_MARGIN_MS = 40
const untilSteps = (n: number, intervalMs: number): number => n * intervalMs + FRAME_MARGIN_MS

describe('usePlayback (Task 17) — play/pause/step/speed via requestAnimationFrame', () => {
  it('play advances the step over time', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })
    expect(result.current.playing).toBe(true)

    // default speed 1×: 1 step every 1000ms.
    act(() => { vi.advanceTimersByTime(untilSteps(1, 1000)) })
    expect(result.current.stepIndex).toBe(1)

    act(() => { vi.advanceTimersByTime(untilSteps(2, 1000)) })
    expect(result.current.stepIndex).toBe(3)
  })

  it('pause holds still — no further advancing', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })
    act(() => { vi.advanceTimersByTime(untilSteps(1, 1000)) })
    expect(result.current.stepIndex).toBe(1)

    act(() => { result.current.pause() })
    expect(result.current.playing).toBe(false)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.stepIndex).toBe(1) // stays put
  })

  it('auto-stops at the end of the trace, re-enables the play button', () => {
    const { result } = renderHook(() => useControlled(18, 20))
    act(() => { result.current.play() })

    act(() => { vi.advanceTimersByTime(untilSteps(2, 1000)) }) // enough for 2 steps: 18 -> 19 -> 20 (max)
    expect(result.current.stepIndex).toBe(20)
    expect(result.current.playing).toBe(false) // auto-stopped

    // Doesn't advance past max no matter how much more time passes.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.stepIndex).toBe(20)
  })

  it('changing speed changes the step-advance rate', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })

    act(() => { result.current.setSpeed(4 as Speed) }) // 4 steps/sec = 250ms/step
    act(() => { vi.advanceTimersByTime(untilSteps(4, 250)) })
    expect(result.current.stepIndex).toBe(4)
  })

  it('user dragging the scrubber while playing stops playback', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })
    act(() => { vi.advanceTimersByTime(500) }) // not yet 1000ms, hasn't auto-advanced any step

    // User drags the Timeline themselves — calls the EXACT SAME setStep the real App would call.
    act(() => { result.current.setStep(15) })
    expect(result.current.stepIndex).toBe(15)
    expect(result.current.playing).toBe(false)

    // Doesn't keep auto-advancing after stopping because the user dragged.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.stepIndex).toBe(15)
  })

  it('unmount cancels the pending requestAnimationFrame', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const { result, unmount } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })

    unmount()
    expect(cancelSpy).toHaveBeenCalled()

    // After unmount, advancing timers must not throw — nothing is listening for rAF anymore.
    expect(() => { act(() => { vi.advanceTimersByTime(5000) }) }).not.toThrow()
  })
})
