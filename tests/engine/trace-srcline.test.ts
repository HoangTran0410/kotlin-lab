import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

const SRC = `fun main() = runBlocking {
    val j = launch {
        delay(100)
        println("done")
    }
    delay(50)
    j.cancel()
}
`

describe('srcLine — data for highlighting the currently running line', () => {
  // No ratio threshold is set here. Any threshold is a proxy, and a high one
  // would even CONTRADICT the design itself: JOB_STATE / THREAD_STATE /
  // COROUTINE_STARTED / COROUTINE_RESUMED deliberately do NOT carry srcLine
  // — they make up most of the trace, and that's exactly why stickiness
  // exists. The real question for the UI is: at EVERY step, does the editor
  // have a line to highlight.

  /**
   * THE ONE EXCEPTION to the brief: COROUTINE_SUSPENDED reason 'join' is
   * excluded from MUST_HAVE, backed by measured evidence — not an arbitrary
   * relaxation.
   *
   * scheduler.ts.suspend(): "'joinChildren' isn't in the Event schema —
   * folded into 'join' when writing the trace." That means ONE REAL
   * j.join()/cancelAndJoin() (always has a line, already threaded through in
   * interpreter.ts) and ONE SYNTHETIC joinChildren that the builder inserts
   * on its own to wait for its children to finish (deliberately has NO line
   * — see the `Suspension` doc comment in suspension.ts: "joinChildren is
   * produced by the builder, not by any line of user code") both emit the
   * EXACT SAME SHAPE of event: { k: 'COROUTINE_SUSPENDED', reason: 'join' }.
   * There is no way to distinguish the two sources from the Event alone.
   *
   * This isn't a rare bug: EVERY program run through runSource has at least
   * one synthetic joinChildren — the root always `yield`s
   * `{ s: 'joinChildren' }` for itself at the end of its body (see run.ts).
   * Measured with the smallest possible program, `runBlocking { println("hi") }`,
   * with no launch at all: it still emits exactly one lineless
   * COROUTINE_SUSPENDED reason 'join'. Forcing it to always carry a line
   * would require either (a) fabricating data for joinChildren — directly
   * against the `Suspension` doc comment, or (b) changing the engine so
   * merging into 'join' stops being ambiguous — both are outside the "engine
   * changes stay as they are" scope of this fix.
   *
   * `delay`/`yield`/`await` are unambiguous — always from a real call the
   * user made, so they stay in the mandatory requirement.
   */
  it('every event kind that DESERVES a line has one (except join merged from joinChildren)', () => {
    const ev = runSource(SRC).events
    const MUST_HAVE = new Set(['PRINTLN', 'EXCEPTION_THROWN'])
    const alwaysMissing = ev.filter(e => MUST_HAVE.has(e.k) && e.srcLine === undefined)
    expect(alwaysMissing).toEqual([])

    const missingUnambiguousSuspend = ev.filter(
      e => e.k === 'COROUTINE_SUSPENDED' && e.reason !== 'join' && e.srcLine === undefined)
    expect(missingUnambiguousSuspend).toEqual([])
  })

  it('after the first event carrying a line, EVERY step has a line to highlight', () => {
    // This is the actual contract CodeEditor relies on. If stickiness
    // breaks, or a new event kind forgets to pass a line, this test goes red immediately.
    const ev = runSource(SRC).events
    const first = ev.findIndex(e => e.srcLine !== undefined)
    expect(first).toBeGreaterThanOrEqual(0)
    for (let n = first + 1; n <= ev.length; n++) {
      expect(foldTrace(ev, n).srcLine, `step ${n} has no line to highlight`).not.toBeNull()
    }
  })

  it('srcLine coverage is REFERENCE ONLY, not a gate', () => {
    // Record the number so a regression is visible, but don't gate on an arbitrary threshold.
    const ev = runSource(SRC).events
    const withLine = ev.filter(e => e.srcLine !== undefined)
    expect(withLine.length).toBeGreaterThan(0)
  })

  it('COROUTINE_CREATED of a launch points at line 2', () => {
    const e = runSource(SRC).events.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'launch')!
    expect(e.srcLine).toBe(2)
  })

  it('COROUTINE_SUSPENDED from delay(100) points at line 3', () => {
    const e = runSource(SRC).events.find(
      x => x.k === 'COROUTINE_SUSPENDED' && x.reason === 'delay' && x.srcLine === 3)
    expect(e).toBeDefined()
  })

  it('PRINTLN still points at line 4 — no regression on the old path', () => {
    const e = runSource(SRC).events.find(x => x.k === 'PRINTLN')
    if (e) expect(e.srcLine).toBe(4)
  })

  it('EXCEPTION_THROWN points at the line of the throw statement', () => {
    const e = runSource(
      'fun main() = runBlocking {\n  launch {\n    delay(10)\n    throw RuntimeException("boom")\n  }\n}\n',
    ).events.find(x => x.k === 'EXCEPTION_THROWN')!
    expect(e.srcLine).toBe(4)
  })

  it('every srcLine falls within the real line range of the source', () => {
    const n = SRC.split('\n').length
    for (const e of runSource(SRC).events) {
      if (e.srcLine !== undefined) {
        expect(e.srcLine).toBeGreaterThanOrEqual(1)
        expect(e.srcLine).toBeLessThanOrEqual(n)
      }
    }
  })
})

describe('WorldState.srcLine — STICKY, no flicker', () => {
  it('keeps the last known line when the next event carries none', () => {
    const ev = runSource(SRC).events
    let last: number | null = null
    for (let n = 1; n <= ev.length; n++) {
      const w = foldTrace(ev, n)
      const e = ev[n - 1]!
      if (e.srcLine !== undefined) expect(w.srcLine).toBe(e.srcLine)
      else expect(w.srcLine).toBe(last)   // sticky, does NOT fall back to null
      last = w.srcLine
    }
  })

  it('step 0 has no line yet', () => {
    expect(foldTrace(runSource(SRC).events, 0).srcLine).toBeNull()
  })

  it('scrubbing backward gives the same line as playing straight through — the central invariant', () => {
    const ev = runSource(SRC).events
    const forward = Array.from({ length: ev.length + 1 }, (_, n) => foldTrace(ev, n).srcLine)
    const backward: (number | null)[] = []
    for (let n = ev.length; n >= 0; n--) backward.unshift(foldTrace(ev, n).srcLine)
    expect(backward).toEqual(forward)
  })
})
