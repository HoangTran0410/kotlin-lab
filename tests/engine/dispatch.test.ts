import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { Scheduler } from '../../src/engine/runtime/scheduler'
import type { VoidCoroutineBody } from '../../src/engine/runtime/suspension'
import type { Event } from '../../src/engine/trace/events'

/**
 * `Event` is a distributive union (`EventBody & {seq,t}`), so
 * `.find(e => e.k === ...)` does NOT narrow the type — reading
 * `.id`/`.dispatcher`/`.threadId` right after is a compile error. Same
 * type-predicate idiom that scope-root.test.ts uses.
 */
type Created = Extract<Event, { k: 'COROUTINE_CREATED' }>
type Dispatch = Extract<Event, { k: 'DISPATCH' }>
type ThreadEv = Extract<Event, { k: 'THREAD_STATE' }>
const createdOf = (events: readonly Event[]): Created[] =>
  events.filter((e): e is Created => e.k === 'COROUTINE_CREATED')
const dispatchOf = (events: readonly Event[]): Dispatch[] =>
  events.filter((e): e is Dispatch => e.k === 'DISPATCH')
const threadsOf = (events: readonly Event[]): ThreadEv[] =>
  events.filter((e): e is ThreadEv => e.k === 'THREAD_STATE')

const idOfPrintln = (src: string, text: string): string => {
  const r = runSource(src)
  const e = r.events.find(x => x.k === 'PRINTLN' && x.text === text)
  if (!e || e.k !== 'PRINTLN') throw new Error(`println "${text}" not found`)
  return e.id
}

/**
 * The thread a given `println` ran on. PRINTLN doesn't carry a threadId, but
 * the scheduler emits THREAD_STATE 'RUNNING' at the start of every run and
 * 'FREE' at the end — so the nearest RUNNING thread BEFORE the print line is
 * the one that ran it.
 */
const threadAtPrintln = (events: readonly Event[], text: string): string => {
  const i = events.findIndex(e => e.k === 'PRINTLN' && e.text === text)
  if (i < 0) throw new Error(`println "${text}" not found`)
  for (let n = i; n >= 0; n--) {
    const e = events[n]!
    if (e.k === 'THREAD_STATE' && e.state === 'RUNNING') return e.threadId
  }
  throw new Error(`no THREAD_STATE RUNNING before println "${text}"`)
}

describe('println is tagged with the correct job of the surrounding inline scope', () => {
  it('println inside withContext carries the id of the withContext job, not the outer job', () => {
    const src = `fun main() = runBlocking {
    println("outer")
    withContext(Dispatchers.IO) { println("inner") }
}`
    const r = runSource(src)
    const wc = createdOf(r.events).find(e => e.builder === 'withContext')!
    expect(idOfPrintln(src, 'inner')).toBe(wc.id)
    expect(idOfPrintln(src, 'outer')).not.toBe(wc.id)
  })

  it('println inside coroutineScope carries the id of the coroutineScope', () => {
    const src = `fun main() = runBlocking {
    coroutineScope { println("inside scope") }
}`
    const r = runSource(src)
    const cs = createdOf(r.events).find(e => e.builder === 'coroutineScope')!
    expect(idOfPrintln(src, 'inside scope')).toBe(cs.id)
  })

  it('leaving the scope re-tags println with the outer job', () => {
    // Guards the stack POP. If only push happens without pop, this case goes red.
    const src = `fun main() = runBlocking {
    coroutineScope { println("inner") }
    println("after")
}`
    const r = runSource(src)
    const root = createdOf(r.events)[0]!
    expect(idOfPrintln(src, 'after')).toBe(root.id)
  })

  it('an inline scope that throws still pops correctly', () => {
    const src = `fun main() = runBlocking {
    try { coroutineScope { throw RuntimeException("boom") } } catch (e: RuntimeException) { }
    println("after error")
}`
    const r = runSource(src)
    const root = createdOf(r.events)[0]!
    expect(idOfPrintln(src, 'after error')).toBe(root.id)
  })

  it('a CHILD of an inline scope failing still lets the scope pop correctly', () => {
    // The THIRD exit path of an inline scope, completely different from the
    // two cases above: the scope's own body does NOT throw, but one of its
    // children fails — the interpreter re-throws at `if (failure)`, a
    // branch that goes through neither completeInline nor failInline. If
    // the pop only lived inside those two functions, the stack would leak a
    // job and EVERY println after that would carry the id of an
    // already-dead scope.
    const src = `fun main() = runBlocking {
    try {
        coroutineScope { launch { throw RuntimeException("boom") } }
    } catch (e: RuntimeException) {
        println("caught")
    }
    println("after child error")
}`
    const r = runSource(src)
    const root = createdOf(r.events)[0]!
    expect(idOfPrintln(src, 'caught')).toBe(root.id)
    expect(idOfPrintln(src, 'after child error')).toBe(root.id)
  })

  it('cancellation landing exactly at the dispatcher-switch point: cleanup carries the launch job, not the withContext job', () => {
    // The window between "create the scope job" and "enter the scope" is
    // real: withContext yields a dispatcher-switch point right after
    // creating the job, and the task sits in the ready queue at that point.
    // If it's cancelled at exactly that moment, unwindCancelled throws into
    // the generator RIGHT AT that yield point — i.e. BEFORE the try that
    // owns the pop.
    //
    // Measured before the fix: `cleanup` carried j4 — the withContext job
    // whose body had never run — while the control case right below gave
    // j2. The push has to live INSIDE the try for that window to disappear.
    const src = `fun main() = runBlocking {
    val j = launch { try { withContext(Dispatchers.IO) { delay(1000) } } finally { println("cleanup") } }
    launch { j.cancel() }
}`
    const r = runSource(src)
    const created = createdOf(r.events)
    const firstLaunch = created.filter(e => e.builder === 'launch')[0]!
    const wc = created.find(e => e.builder === 'withContext')!
    expect(idOfPrintln(src, 'cleanup')).toBe(firstLaunch.id)
    expect(idOfPrintln(src, 'cleanup')).not.toBe(wc.id)
  })

  it('control: the same program WITHOUT withContext gives the same id', () => {
    // Without this case, the one above proves nothing: we need to see that
    // the correct id is the same id a program WITHOUT an inline scope produces.
    const src = `fun main() = runBlocking {
    val j = launch { try { delay(1000) } finally { println("cleanup") } }
    launch { j.cancel() }
}`
    const r = runSource(src)
    const firstLaunch = createdOf(r.events).filter(e => e.builder === 'launch')[0]!
    expect(idOfPrintln(src, 'cleanup')).toBe(firstLaunch.id)
  })

  it("two interleaved coroutines: one's println does not carry the other's inline job", () => {
    const src = `fun main() = runBlocking {
    launch { coroutineScope { delay(50); println("inside scope A") } }
    launch { delay(10); println("B outside scope") }
    delay(200)
}`
    const r = runSource(src)
    const a = r.events.find(e => e.k === 'PRINTLN' && e.text === 'inside scope A')!
    const b = r.events.find(e => e.k === 'PRINTLN' && e.text === 'B outside scope')!
    const cs = createdOf(r.events).find(e => e.builder === 'coroutineScope')!
    if (a.k !== 'PRINTLN' || b.k !== 'PRINTLN') throw new Error('missing println')
    expect(a.id).toBe(cs.id)
    expect(b.id).not.toBe(cs.id)
  })
})

describe('withContext performs a real dispatcher switch', () => {
  it('the withContext body runs on a thread of the new dispatcher', () => {
    const r = runSource(`fun main() = runBlocking {
    println("on main")
    withContext(Dispatchers.IO) { println("on IO") }
    println("back on main")
}`)
    const threads = new Set(threadsOf(r.events).map(e => e.threadId))
    expect([...threads].some(t => t.startsWith('IO-'))).toBe(true)
    expect([...threads].some(t => t.startsWith('Main-'))).toBe(true)
  })

  it('emits DISPATCH both entering and leaving withContext', () => {
    const r = runSource(`fun main() = runBlocking {
    withContext(Dispatchers.IO) { println("x") }
}`)
    const d = dispatchOf(r.events)
    expect(d.length).toBeGreaterThanOrEqual(2)
    expect(d.some(e => e.dispatcher === 'IO')).toBe(true)
  })

  it('DISPATCH carries the correct job and thread on both the outbound and return legs', () => {
    // The case above only checks `dispatcher`, so swapping the jobId
    // between the outbound and return legs would still pass. `id` is what
    // foldTrace actually uses to move a node's thread (world.ts:71-74):
    //  - the OUTBOUND leg is named after the withContext job — it's the
    //    one being moved to IO;
    //  - the RETURN leg is named after the CALLING job — by then the
    //    withContext job has Completed, and moving the thread for an
    //    already-dead node is an impossible shape.
    const r = runSource(`fun main() = runBlocking {
    withContext(Dispatchers.IO) { println("x") }
}`)
    const root = createdOf(r.events)[0]!
    const wc = createdOf(r.events).find(e => e.builder === 'withContext')!
    expect(dispatchOf(r.events).map(e => ({ id: e.id, dispatcher: e.dispatcher, threadId: e.threadId })))
      .toEqual([
        { id: wc.id, dispatcher: 'IO', threadId: 'IO-1' },
        { id: root.id, dispatcher: 'Main', threadId: 'Main-1' },
      ])
  })

  it('the outbound DISPATCH points at the exact line that calls withContext', () => {
    // Guards the `line` field of the switchContext suspension. Removing it
    // would leave the editor with no line to highlight at the exact
    // thread-switch step — the step the lesson wants to point at.
    const r = runSource(`fun main() = runBlocking {
    println("before")
    withContext(Dispatchers.IO) { println("inner") }
}`)
    expect(dispatchOf(r.events)[0]!.srcLine).toBe(3)
  })

  it('withContext with the SAME dispatcher does NOT switch thread and does not emit DISPATCH', () => {
    // Kotlin: withContext with the same dispatcher doesn't re-dispatch.
    // Without this condition, every withContext would emit a bogus DISPATCH
    // and the "switch dispatcher" lesson would lose all meaning.
    const r = runSource(`fun main() = runBlocking {
    withContext(CoroutineName("just renaming")) { println("x") }
}`)
    expect(dispatchOf(r.events)).toHaveLength(0)
  })

  it('the result of withContext is still correctly returned to the caller', () => {
    // Switching threads must not lose the return value.
    const r = runSource(`fun main() = runBlocking {
    val v = withContext(Dispatchers.IO) { 5 }
    println(v)
}`)
    expect(r.output).toEqual(['5'])
  })

  it('println inside withContext still stays in correct order relative to the outside', () => {
    const r = runSource(`fun main() = runBlocking {
    println("1")
    withContext(Dispatchers.IO) { println("2") }
    println("3")
}`)
    expect(r.output).toEqual(['1', '2', '3'])
  })

  it('each println runs on the correct thread for the dispatcher in effect', () => {
    const r = runSource(`fun main() = runBlocking {
    println("on main")
    withContext(Dispatchers.IO) { println("on IO") }
    println("back on main")
}`)
    expect(threadAtPrintln(r.events, 'on main')).toMatch(/^Main-/)
    expect(threadAtPrintln(r.events, 'on IO')).toMatch(/^IO-/)
    expect(threadAtPrintln(r.events, 'back on main')).toMatch(/^Main-/)
  })

  it('withContext body THROWING still switches the dispatcher back', () => {
    // Verified against Kotlin 2.1.20 (playground): after
    // withContext(Dispatchers.IO) throws, both the `catch` and the
    // statement after it run on the `main` thread. If the throw path
    // doesn't go through `finally { yield switchContext(old) }`, the
    // calling coroutine stays on IO forever — the trace would say
    // runBlocking runs on IO-1.
    const r = runSource(`fun main() = runBlocking {
    try {
        withContext(Dispatchers.IO) { println("on IO"); throw RuntimeException("boom") }
    } catch (e: RuntimeException) {
        println("caught")
    }
    println("after error")
}`)
    expect(threadAtPrintln(r.events, 'on IO')).toMatch(/^IO-/)
    expect(threadAtPrintln(r.events, 'caught')).toMatch(/^Main-/)
    expect(threadAtPrintln(r.events, 'after error')).toMatch(/^Main-/)
  })
})

describe('engine invariant errors must not be swallowed while unwinding', () => {
  it('an Error thrown from finally during unwind surfaces to the caller', () => {
    // The "inline stack top must match" check (exitInline) only means
    // anything if it can actually throw OUT. unwindCancelled used to catch
    // with a bare `catch`, so an invariant error thrown from a `finally`
    // mid-unwind would vanish and even REPLACE the in-flight
    // CancellationException.
    //
    // Built directly on top of Scheduler instead of via Kotlin source: no
    // valid Kotlin snippet can desync the stack (that's the whole point of
    // this task), so the only way is to inject an invariant Error straight
    // onto that exact path.
    const s = new Scheduler()
    s.spawnRoot(() => (function* (): VoidCoroutineBody {
      const child = s.spawnChild(function* (): VoidCoroutineBody {
        try {
          yield { s: 'delay', ms: 1000 }
        } finally {
          throw new Error('Scheduler: inline stack mismatch (simulated)')
        }
      })
      yield { s: 'delay', ms: 10 }
      s.cancel(child, {
        exType: 'CancellationException', message: 'Job was cancelled', isCancellation: true,
      })
      yield { s: 'delay', ms: 10 }
    })())
    expect(() => { s.runToCompletion() }).toThrow('inline stack mismatch')
  })

  it('a KOTLIN exception re-thrown during unwind is still swallowed as before', () => {
    // The other half of the contract: `finally` finishes running and then
    // the generator re-throws CancellationException — that's NORMAL. If the
    // filter condition is too aggressive, every program with a cancelled
    // coroutine would blow up.
    const r = runSource(`fun main() = runBlocking {
    val j = launch { try { delay(1000) } finally { println("cleanup") } }
    delay(10)
    j.cancel()
    delay(10)
    println("done")
}`)
    expect(r.output).toEqual(['cleanup', 'done'])
  })
})

describe('DISPATCH when a child coroutine runs on a different dispatcher than its parent', () => {
  it('launch(Dispatchers.IO) from Main emits DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch(Dispatchers.IO) { delay(10) }
    delay(50)
}`)
    expect(dispatchOf(r.events).some(e => e.dispatcher === 'IO')).toBe(true)
  })

  it('launch(IO) created BEFORE the parent switches dispatcher still emits its own DISPATCH', () => {
    // The baseline for comparison is the parent's dispatcher AT CREATION
    // TIME, not when the child first runs. Here the parent does
    // `withContext(Dispatchers.IO)` RIGHT AFTER the launch call, and
    // `suspend()` overwrites the parent's `task.ctx` right at that yield
    // point — i.e. BEFORE the child (sitting ahead of the parent in the
    // ready queue) gets a chance to run. Reading the parent's ctx at that
    // point would see IO === IO and swallow the child's DISPATCH.
    //
    // Measured both designs on this exact program:
    //   capture-at-creation: [j2->IO, j3->IO, j1->Main]   (j2 = the launched child)
    //   read-at-run-time:    [j3->IO, j1->Main]           (j2 disappears)
    // Kotlin dispatches the child's first continuation right at the
    // `launch` call site (CoroutineStart.DEFAULT), so the version with j2
    // is the correct one.
    const r = runSource(`fun main() = runBlocking {
    launch(Dispatchers.IO) { delay(10) }
    withContext(Dispatchers.IO) { delay(100) }
}`)
    const child = createdOf(r.events).find(e => e.builder === 'launch')!
    expect(dispatchOf(r.events).map(e => e.id)).toContain(child.id)
  })

  it('launch on the same dispatcher as the parent does NOT emit DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    expect(dispatchOf(r.events)).toHaveLength(0)
  })
})
