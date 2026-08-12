import { useCallback, useEffect, useRef, useState } from 'react'

/** steps per second. */
export type Speed = 0.5 | 1 | 2 | 4

export interface PlaybackApi {
  playing: boolean
  speed: Speed
  play: () => void
  pause: () => void
  setSpeed: (s: Speed) => void
}

/**
 * Advances `stepIndex` automatically using `requestAnimationFrame` — not
 * `setInterval`: runs in sync with the frame and AUTO-STOPS when the tab is
 * hidden (the browser stops handing out rAF callbacks to background tabs).
 * The ban on `setTimeout` only applies to `src/engine/**`; the UI is allowed
 * to use real timers, but rAF is still the better fit for this specific job.
 *
 * `stepIndex`/`setStep`/`max` are read through a ref inside the rAF loop, NOT
 * listed in the deps of the effect that runs the loop: if they were listed,
 * the effect would tear down and re-schedule `requestAnimationFrame` every
 * time `stepIndex` changes — that is, on EVERY STEP — breaking the
 * accumulated timing between `lastTickRef` and `now`.
 *
 * On reaching the end of the trace (`stepIndex === max`) it auto-stops — no
 * more step to play, and staying stopped means the play button keeps showing
 * "Play" (instead of being stuck showing "currently playing" forever).
 */
/**
 * `advance` decides the NEXT step from the current one. Defaults to `cur + 1`
 * (one event at a time, used by the debug panel's timeline).
 *
 * The graph stage passes a different function: jump to the next NARRATED
 * step. More than half the events in a trace are infrastructure
 * (`THREAD_STATE`, `JOB_STATE`) — playing one event at a time would leave the
 * screen frozen most of the time, and viewers would think the tool had
 * hung. There's still only ONE copy of the time loop, right here.
 */
/**
 * `stopAt` is asked, after each step is chosen, whether playback should stop
 * THERE.
 *
 * Deliberately inside the loop rather than an effect watching `stepIndex` from
 * outside. An outside watcher only sees the steps React actually renders, and
 * React batches: measured with fake timers advancing 30s in one go, the loop
 * ran through the stop step and the watcher never observed it, so playback
 * sailed past a breakpoint to the end of the trace. Real frames are spread out
 * enough that a watcher usually works — which is exactly what makes that bug
 * the kind that only shows up sometimes.
 */
export function usePlayback(
  stepIndex: number,
  setStep: (n: number) => void,
  max: number,
  advance?: (cur: number) => number,
  stopAt?: (step: number) => boolean,
): PlaybackApi {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState<Speed>(1)
  const advanceRef = useRef(advance)
  useEffect(() => { advanceRef.current = advance }, [advance])
  const stopAtRef = useRef(stopAt)
  useEffect(() => { stopAtRef.current = stopAt }, [stopAt])

  const stepIndexRef = useRef(stepIndex)
  const setStepRef = useRef(setStep)
  const maxRef = useRef(max)
  const speedRef = useRef(speed)
  const lastTickRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  // true for exactly one `stepIndex` change: marks that change as caused by
  // the play loop ITSELF, so the watcher effect below can tell it apart from
  // the user dragging the Timeline while playing.
  const ownUpdateRef = useRef(false)

  useEffect(() => { stepIndexRef.current = stepIndex }, [stepIndex])
  useEffect(() => { setStepRef.current = setStep }, [setStep])
  useEffect(() => { maxRef.current = max }, [max])
  useEffect(() => { speedRef.current = speed }, [speed])

  // User drags the Timeline while playing -> playback must stop, otherwise
  // the scrubber would fight the user's finger (playback keeps overwriting
  // the position the user just dragged to on the next frame).
  useEffect(() => {
    if (ownUpdateRef.current) { ownUpdateRef.current = false; return }
    setPlaying(prev => (prev ? false : prev))
  }, [stepIndex])

  useEffect(() => {
    if (!playing) { lastTickRef.current = null; return }

    let cancelled = false
    // Read time with Date.now(), NOT the `now` parameter rAF passes to the
    // callback: measured with a probing test — under fake timers (vitest,
    // @sinonjs/fake-timers) that parameter is still the REAL
    // performance.now() (the real system clock), not synced with the virtual
    // clock that vi.advanceTimersByTime controls, so the `now - lastTick`
    // difference is almost always 0 and playback never advances in tests.
    // Date.now(), on the other hand, IS faked by fake timers (by default in
    // toFake) and advances in step when you advance them.
    const tick = (): void => {
      if (cancelled) return
      const now = Date.now()
      if (lastTickRef.current === null) lastTickRef.current = now

      const intervalMs = 1000 / speedRef.current
      if (now - lastTickRef.current >= intervalMs) {
        lastTickRef.current = now
        const raw = advanceRef.current
          ? advanceRef.current(stepIndexRef.current)
          : stepIndexRef.current + 1
        // Always advance at least one step: an `advance` that returns a value
        // no greater than the current one would leave the play loop stuck in
        // place while the button still shows "playing".
        const next = Math.min(maxRef.current, Math.max(stepIndexRef.current + 1, raw))
        if (next !== stepIndexRef.current) {
          ownUpdateRef.current = true
          stepIndexRef.current = next
          setStepRef.current(next)
        }
        if (next >= maxRef.current) {
          setPlaying(false)
          return // reached the end: auto-stop, don't request another frame
        }
        if (stopAtRef.current?.(next) === true) {
          setPlaying(false)
          return // landed on a stop (a breakpoint): hold here
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing])

  const play = useCallback(() => {
    if (stepIndexRef.current >= maxRef.current) return // already at the end, nothing to play
    setPlaying(true)
  }, [])
  const pause = useCallback(() => setPlaying(false), [])
  const setSpeed = useCallback((s: Speed) => setSpeedState(s), [])

  return { playing, speed, play, pause, setSpeed }
}
