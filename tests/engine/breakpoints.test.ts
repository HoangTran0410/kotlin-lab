import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import {
  isBreakpointStep, linesInTrace, nextBreakpointStep, prevBreakpointStep,
} from '../../src/engine/trace/breakpoints'
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
const EVENTS = runSource(SRC).events
const line = (n: number) => new Set([n])

describe('breakpoints over a finished trace', () => {
  it('stops ON the line, not one event short', () => {
    // Off-by-one here is what makes a debugger feel broken: the step index
    // means "this many events applied", so the event that REACHED the line
    // has to be folded in already.
    const at = nextBreakpointStep(EVENTS, 0, line(5))!
    expect(at).not.toBeNull()
    expect(foldTrace(EVENTS, at).srcLine, 'stopped on the wrong line').toBe(5)
  })

  it('a line hit three times is three separate stops', () => {
    // `println` inside repeat(3). A breakpoint marks a LINE, and a line can be
    // reached many times — each is its own stop.
    const stops: number[] = []
    let at = nextBreakpointStep(EVENTS, 0, line(5))
    while (at !== null) { stops.push(at); at = nextBreakpointStep(EVENTS, at, line(5)) }
    expect(stops).toHaveLength(3)
    expect(new Set(stops).size, 'the same stop was reported twice').toBe(3)
    for (const s of stops) expect(foldTrace(EVENTS, s).srcLine).toBe(5)
  })

  it('standing on a hit does not report that same hit again', () => {
    // Otherwise "continue" would never leave the line it is already on.
    const first = nextBreakpointStep(EVENTS, 0, line(5))!
    const second = nextBreakpointStep(EVENTS, first, line(5))!
    expect(second).toBeGreaterThan(first)
  })

  it('returns null when nothing ahead, and when there are no breakpoints', () => {
    expect(nextBreakpointStep(EVENTS, EVENTS.length, line(5))).toBeNull()
    expect(nextBreakpointStep(EVENTS, 0, new Set())).toBeNull()
    expect(nextBreakpointStep(EVENTS, 0, line(9999))).toBeNull()
  })

  it('goes backwards too — the trace is a finished record, not a live process', () => {
    const last = nextBreakpointStep(EVENTS, 0, line(5))!
    const third = nextBreakpointStep(EVENTS, nextBreakpointStep(EVENTS, last, line(5))!, line(5))!
    const back = prevBreakpointStep(EVENTS, third, line(5))!
    expect(back).toBeLessThan(third)
    expect(foldTrace(EVENTS, back).srcLine).toBe(5)
    expect(prevBreakpointStep(EVENTS, 0, line(5))).toBeNull()
  })

  it('isBreakpointStep agrees with where nextBreakpointStep lands', () => {
    // Two functions, one notion of "on a breakpoint". If they disagreed,
    // playback would stop somewhere the button says is not a stop.
    const at = nextBreakpointStep(EVENTS, 0, line(5))!
    expect(isBreakpointStep(EVENTS, at, line(5))).toBe(true)
    expect(isBreakpointStep(EVENTS, at - 1, line(5))).toBe(false)
    expect(isBreakpointStep(EVENTS, 0, line(5))).toBe(false)
  })

  it('linesInTrace reports lines that run, and omits ones that never do', () => {
    // This is what lets the gutter dim a breakpoint that can never be hit,
    // instead of leaving the user to conclude the tool is broken.
    const lines = linesInTrace(EVENTS)
    expect(lines.has(5), 'the println line never ran?').toBe(true)
    expect(lines.has(1), 'the import line is not executable').toBe(false)
    expect(lines.has(2), 'a blank line is not executable').toBe(false)
  })
})
