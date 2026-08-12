import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('cancellation reaching delay() inside an inline scope body', () => {
  it('coroutineScope: a child failing cuts short the delay in the scope body itself, immediately', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            delay(1000)
            println("NOT-PRINTED")
        }
    } catch (e: RuntimeException) {
        println("caught: " + e.message)
    }
}`)
    expect(r.output).toEqual(['caught: boom'])
  })

  it('cuts at the exact MOMENT, not just the right content', () => {
    // If only the println were blocked while still letting the virtual
    // clock run out the full 1000ms, the output would look identical to
    // the case above but the "stops IMMEDIATELY" lesson would be wrong.
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { delay(50); throw RuntimeException("boom") }
            delay(1000)
        }
    } catch (e: RuntimeException) { }
    println("done")
}`)
    const last = r.events[r.events.length - 1]!
    expect(last.t).toBeLessThan(200)
  })

  it('supervisorScope: a blocked child failure means the body delay is NOT cut short', () => {
    // The control case. Without it, a fix that just says "any child failing
    // cuts the body" would still pass the first case while breaking
    // supervisor semantics.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        launch { throw RuntimeException("boom") }
        delay(1000)
        println("MUST-PRINT")
    }
}`)
    expect(r.output).toEqual(['MUST-PRINT'])
  })

  it('nested scopes: only the cancelled scope is cut, the outer scope keeps running', () => {
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        try {
            coroutineScope {
                launch { throw RuntimeException("inner") }
                delay(1000)
                println("NOT-PRINTED")
            }
        } catch (e: RuntimeException) {
            println("caught in inner scope: " + e.message)
        }
        delay(100)
        println("outer scope still running")
    }
}`)
    expect(r.output).toEqual(['caught in inner scope: inner', 'outer scope still running'])
  })

  it('finally inside the scope body still runs when cut short', () => {
    // Same reason as M1's Task 18: cancellation must go through the path
    // that throws into the generator, not the path that just flips a state
    // flag.
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            try {
                delay(1000)
            } finally {
                println("cleanup")
            }
        }
    } catch (e: RuntimeException) {
        println("caught")
    }
}`)
    expect(r.output).toEqual(['cleanup', 'caught'])
  })

  it('nested withContext scope: the caller still sees "boom", not a CancellationException', () => {
    // The withContext job gets dragged down by cancelJob when a sibling
    // fails, so it has NO `failure` and its body receives a
    // CancellationException. If the enclosing coroutineScope just
    // re-threw whatever had just flown through its body, that
    // CancellationException would leak out to the caller,
    // `catch (e: RuntimeException)` wouldn't match, and "boom" would
    // vanish — silently, empty output.
    // Verified against real Kotlin (api.kotlinlang.org 2.4.10): prints
    // exactly "caught: boom".
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            withContext(Dispatchers.IO) {
                delay(1000)
                println("NOT-PRINTED")
            }
        }
    } catch (e: RuntimeException) {
        println("caught: " + e.message)
    }
}`)
    expect(r.output).toEqual(['caught: boom'])
  })

  it('swallowing CancellationException and then suspending again: the later suspend point still gets cut', () => {
    // Kotlin throws CancellationException at EVERY suspend point of a
    // cancelled coroutine, not just the first one. If the cancellation
    // signal were only sent once, `delay(50)` inside the catch block would
    // run to completion and "after delay" would print — the engine would
    // be teaching the exact opposite of the single most important rule of
    // cancellation.
    // Verified against real Kotlin (api.kotlinlang.org 2.4.10): prints
    // "done", "caught".
    const r = runSource(`fun main() = runBlocking {
    val j = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("caught")
            delay(50)
            println("after delay")
        }
    }
    delay(10)
    j.cancel()
    println("done")
}`)
    expect(r.output).toEqual(['done', 'caught'])
  })

  it('a finally WRAPPING an inline scope still runs when cancellation comes from outside', () => {
    // The third of three cancellation points that tryBuilder's `finally`
    // must cover: a task suspended in the middle of an inline scope's
    // body, cancelled from OUTSIDE (not from a child failing). The
    // generator catches the signal and then does `yield joinChildren` to
    // wait for children to clean up, so `body.throw()` RETURNS instead of
    // throwing; abandoning it there would silently skip every `finally`
    // after that point, leaving empty output.
    // Verified against real Kotlin (api.kotlinlang.org 2.4.10): prints
    // exactly "cleanup".
    const r = runSource(`fun main() = runBlocking {
    val j = launch {
        try {
            coroutineScope { delay(1000) }
        } finally {
            println("cleanup")
        }
    }
    delay(10)
    j.cancel()
}`)
    expect(r.output).toEqual(['cleanup'])
  })
})
