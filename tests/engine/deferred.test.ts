import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('async returns a value', () => {
  it('await() returns the value of the final expression', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { 42 }
    println(d.await())
}`)
    expect(r.output).toEqual(['42'])
  })

  it('await() returns the value after the async body has suspended', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(100); "done" }
    println(d.await())
}`)
    expect(r.output).toEqual(['done'])
  })

  it('two independent Deferreds return their own value, without mixing them up', () => {
    // This case catches the "shared resumeValue" bug: if the value gets
    // written to one shared global spot instead of the specific waiting
    // task, the two results would swap or collide.
    const r = runSource(`fun main() = runBlocking {
    val a = async { delay(200); "A" }
    val b = async { delay(100); "B" }
    println(a.await())
    println(b.await())
}`)
    expect(r.output).toEqual(['A', 'B'])
  })

  it('await() still WAITS for the right moment, not just returns a value', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(300); 7 }
    println(d.await())
}`)
    const in7 = r.events.find(e => e.k === 'PRINTLN')!
    expect(in7.t).toBe(300)
  })

  it('an async lambda takes the last expression as its value, even with other statements before it', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { println("extra"); 99 }
    println(d.await())
}`)
    expect(r.output).toEqual(['extra', '99'])
  })
})

describe('async keeps the failure inside the Deferred, throws at the await point', () => {
  it('supervisorScope: await() throws even though the supervisor blocks the failure from the scope', () => {
    // The DECIDING case. Before the fix: printed "no exception seen".
    // Real Kotlin: a supervisor blocks the effect on the scope/siblings, it
    // does NOT block directly reading an already-failed Deferred.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("boom") }
        delay(50)
        try {
            d.await()
            println("no exception seen")
        } catch (e: RuntimeException) {
            println("caught: " + e.message)
        }
        println("scope keeps running")
    }
}`)
    expect(r.output).toEqual(['caught: boom', 'scope keeps running'])
  })

  it('await() on a Deferred that ALREADY failed earlier still throws (not only while suspended)', () => {
    // A completely different code path: by the time await is called, the
    // job has already settled, so the scheduler pushes it straight into
    // ready instead of into waiters. Implementing only the waiters branch
    // would let this case slip through.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("early") }
        delay(200)
        try { d.await(); println("slipped through") } catch (e: RuntimeException) { println("caught: " + e.message) }
    }
}`)
    expect(r.output).toEqual(['caught: early'])
  })

  it('async failing STILL propagates up structurally to the parent, even when nobody awaits it', () => {
    // Guards behaviour that's already CORRECT from being broken by this
    // task: fixing await must not turn async into "the failure only exists
    // inside the Deferred".
    const r = runSource(`fun main() = runBlocking {
    async { throw RuntimeException("boom") }
    delay(100)
    println("should not reach here")
}`)
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'FAILURE_PROPAGATED')).toBe(true)
  })

  it('await() on a CANCELLED Deferred throws CancellationException, does not return Unit', () => {
    // Not covered in the spec. Verified against real Kotlin (2.1.20):
    // `d.cancel()` then `d.await()` throws "DeferredCoroutine was cancelled".
    // If wakeAwaiter only checked `failure`, a Deferred cancelled from
    // outside (failure = null) would silently return Unit and the program
    // would keep going — MEASURED as `"value: kotlin.Unit"`.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { delay(1000); 5 }
        d.cancel()
        try {
            println("value: " + d.await())
        } catch (e: CancellationException) {
            println("await threw CancellationException")
        }
        println("scope keeps running")
    }
}`)
    expect(r.output).toEqual(['await threw CancellationException', 'scope keeps running'])
  })

  it('join() does NOT throw — only await() throws', () => {
    // This distinction is exactly the content of the launchasync lesson.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("boom") }
        d.join()
        println("join done, no throw")
    }
}`)
    expect(r.output).toEqual(['join done, no throw'])
  })
})
