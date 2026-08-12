import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'
import { foldTrace } from '../../src/engine/trace/world'

/**
 * The line cursor in the editor must FOLLOW the execution flow.
 *
 * Measured before the fix: only 16-21% of events carried a `srcLine`, and
 * there was a stretch of 16 consecutive events with no line change — a user
 * dragging the timeline would see the cursor sit frozen and think the tool
 * had hung.
 */
describe('srcLine — the line follows the execution flow', () => {
  it('COROUTINE_STARTED points at the FIRST line of the coroutine body, not the line that wrote launch', () => {
    //  1 import
    //  2 (blank)
    //  3 fun main() = runBlocking {
    //  4     launch {
    //  5         println("inside body")
    //  6     }
    //  7     delay(50)
    //  8 }
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch {
        println("inside body")
    }
    delay(50)
}`)
    const created = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    const createdId = created.k === 'COROUTINE_CREATED' ? created.id : ''
    const started = r.events.find(e => e.k === 'COROUTINE_STARTED' && e.id === createdId)!
    expect(created.srcLine, 'CREATED must point at the line that wrote launch').toBe(4)
    expect(started.srcLine, 'STARTED must point at the first line of the BODY').toBe(5)
  })

  it('COROUTINE_RESUMED points at the exact suspend point it was suspended at', () => {
    //  4     launch {
    //  5         delay(100)
    //  6         println("after delay")
    //  7     }
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch {
        delay(100)
        println("after delay")
    }
    delay(200)
}`)
    const child = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    const childId = child.k === 'COROUTINE_CREATED' ? child.id : ''
    const suspended = r.events.find(e => e.k === 'COROUTINE_SUSPENDED' && e.id === childId)!
    const resumed = r.events.find(e => e.k === 'COROUTINE_RESUMED' && e.id === childId)!
    expect(suspended.srcLine).toBe(5)
    expect(resumed.srcLine, 'RESUMED must point back to the exact spot it was suspended at').toBe(5)
  })

  it('a cancellation event points at where the VICTIM was standing, not the throw line', () => {
    //  5         launch { delay(500); println("A") }     <- victim suspended here
    //  6         launch { delay(50); throw RuntimeException("boom") }
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    coroutineScope {
        launch { delay(500); println("A") }
        launch { delay(50); throw RuntimeException("boom") }
    }
}`)
    const created = r.events.filter(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')
    const first = created[0]!
    const victim = first.k === 'COROUTINE_CREATED' ? first.id : ''
    const thrown = r.events.find(e => e.k === 'EXCEPTION_THROWN')!
    expect(thrown.srcLine, 'throw is on line 6').toBe(6)

    const cancelled = r.events.find(e => e.k === 'JOB_STATE' && e.id === victim && e.to === 'Cancelled')!
    expect(cancelled.srcLine, 'the victim is suspended at the delay on line 5 when it gets killed').toBe(5)
    expect(cancelled.srcLine).not.toBe(thrown.srcLine)
  })

  it('every lesson: the line changes at least 1/4 of the time across steps, and never sits still for more than 10 consecutive steps', () => {
    // This is the measurement CLOSEST to the real experience: the learner
    // clicks the step button (see GraphStage), not dragging through
    // individual events. The threshold is set below the currently measured
    // level (lowest 28%, longest freeze 10) so it doesn't go red from small
    // fluctuations, but still goes red if someone rips out the
    // line-tagging work.
    for (const l of LESSONS) {
      const ev = runSource(loadLessonSource(l.id)).events
      const steps = narrateTrace(ev)
      let changes = 0, prev: number | null = null, freezeMax = 0, freeze = 0
      for (const m of steps) {
        const line = foldTrace(ev, m.index + 1).srcLine
        if (line !== prev) { changes++; prev = line ?? null; freeze = 1 } else { freeze++; freezeMax = Math.max(freezeMax, freeze) }
      }
      expect(changes / steps.length, `${l.id}: the line barely changes while stepping through`).toBeGreaterThan(0.25)
      expect(freezeMax, `${l.id}: there's a long stretch where the cursor sits still`).toBeLessThanOrEqual(10)
    }
  })
})
