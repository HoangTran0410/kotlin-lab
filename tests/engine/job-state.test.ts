import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('job.isActive / isCancelled / isCompleted read the REAL state', () => {
  it('a SUSPENDED coroutine still has an ACTIVE Job — the core of the suspend lesson', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        println("A")
        delay(1000)
        println("B")
    }
    delay(10)
    println("mid-delay, isActive = " + job.isActive)
    job.join()
    println("done, isActive = " + job.isActive)
}`)
    expect(r.output).toEqual([
      'A',
      'mid-delay, isActive = true',
      'B',
      'done, isActive = false',
    ])
  })

  it('after cancel: isCancelled true, isActive false, isCompleted true', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(1000) }
    delay(10)
    job.cancelAndJoin()
    println(job.isActive)
    println(job.isCancelled)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true', 'true'])
  })

  it('a job that finishes normally: isCancelled false but isCompleted true', () => {
    // Distinguishing these two is exactly the lesson. An incorrect
    // implementation like "isCompleted = !isActive" would still pass the
    // case above but fail this one.
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    job.join()
    println(job.isCancelled)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true'])
  })

  it('isCompleted is false right after launch, before the job gets a chance to run', () => {
    // HISTORY (before Task 19): the first review pass (Task 4) wrongly
    // concluded that NO case using Kotlin source code could distinguish
    // `isCompleted` from `!isActive`, because that reasoning only
    // considered a job being observed at Active/Completed/Cancelled — it
    // missed the `New` state that the engine (before the fix) exposed:
    // `Scheduler.spawn` pushed the job into `ready` WITHOUT transitioning
    // its state, `New -> Active` only happened on the FIRST step(), so
    // right after `val job = launch { ... }` the job was still `New` — and
    // that used to be the ONLY case in the whole test suite that
    // distinguished `isCompleted` from the mutation `!isActive` (New:
    // isActive false -> !isActive true, WRONG).
    //
    // Task 19 fixed exactly that gap: `isActive` is now true from the
    // moment of creation (matching real CoroutineStart.DEFAULT), so `New`
    // is no longer observable from Kotlin code — the window this case used
    // to exploit to catch the mutation has closed. Measured: after the
    // fix, applying the "isCompleted = !isActive" mutation to job.ts and
    // running ALL 510 tests — none of them went red, including this one.
    // The guard for that mutation moved down to Job's own unit tests
    // (runtime-job.test.ts, 'isCompleted DIFFERS from !isActive — a
    // freshly created job (New) has both false'), where `New` is still
    // directly observable on the Job object itself. The case below now
    // only asserts the isCompleted value matches real Kotlin, no longer
    // serving as a mutation guard.
    //
    // Verified against real Kotlin (api.kotlinlang.org, same program):
    // prints "false" then "true" — matching the assertion below exactly.
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    println(job.isCompleted)
    job.join()
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true'])
  })
})

describe('bare isActive and ensureActive() inside a coroutine body', () => {
  it('an isActive loop stops when cancelled', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        var i = 0
        while (isActive) {
            println("tick " + i)
            i = i + 1
            delay(100)
        }
        println("exited the loop")
    }
    delay(250)
    job.cancelAndJoin()
    println("cancelled")
}`)
    // t=0,100,200 print three ticks; t=250 cancel; the loop never runs a fourth tick.
    expect(r.output.filter(l => l.startsWith('tick'))).toEqual(['tick 0', 'tick 1', 'tick 2'])
    expect(r.output[r.output.length - 1]).toBe('cancelled')
  })

  it("bare isActive reads the LEXICALLY ENCLOSING coroutine's job, not whichever job is currently running", () => {
    // An implementation based on scheduler.currentJob would, after the
    // first suspend, point at the wrong job — and the case above could
    // still stay green while the semantics are wrong.
    //
    // The identifier is spelled `outer` — the lexer only accepts
    // [A-Za-z0-9_] for identifiers (this was originally discovered because
    // the source spec used the accented Vietnamese name `ngoài`, which the
    // lexer rejected with a real error at line 2, column 12: "Lexer:
    // unrecognized character 'à'" — a bug in the spec, not in the
    // implementation; string literals, by contrast, can contain any
    // character).
    const r = runSource(`fun main() = runBlocking {
    val outer = launch {
        delay(10)
        launch { delay(500) }
        println("inside outer launch: " + isActive)
    }
    outer.join()
}`)
    expect(r.output).toEqual(['inside outer launch: true'])
  })

  it('bare isActive reads false after the job has been cancelled — not a hard-coded true', () => {
    // The first review pass (Task 4) pointed out: the two bare-isActive
    // cases above do NOT distinguish a real implementation from a
    // hard-coded `return { t: 'bool', v: true }` — the "loop" case exits
    // via a CancellationException thrown straight into the generator at
    // delay() (the while (isActive) condition is never actually EVALUATED
    // to false), and the "LEXICALLY ENCLOSING" case only asserts the value
    // `true`, which is also what the "no job found" branch
    // (env.enclosingJobId === null) returns.
    //
    // This case reads bare isActive inside a catch (e: CancellationException)
    // of a job that HAS ALREADY been cancelled — job.isActive at that point
    // is GENUINELY false. Same shape as the ensureActive() case right
    // below. Verified against real Kotlin (api.kotlinlang.org): prints
    // "caught", "isActive after cancel = false", "done" — matching the
    // assertion below exactly.
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("caught cancellation")
            println("isActive after cancel = " + isActive)
        }
    }
    delay(10)
    job.cancelAndJoin()
    println("done")
}`)
    expect(r.output).toEqual(['caught cancellation', 'isActive after cancel = false', 'done'])
  })

  it('ensureActive() throws CancellationException when the job has already been cancelled', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("caught cancellation")
        }
        ensureActive()
        println("never reached")
    }
    delay(10)
    job.cancelAndJoin()
    println("done")
}`)
    expect(r.output).toEqual(['caught cancellation', 'done'])
  })
})
