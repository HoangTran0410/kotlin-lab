import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import type { Event } from '../../src/engine/trace/events'

/**
 * `Event` is a distributive union (`EventBody & {seq,t}`), so
 * `.filter(e => e.k === ...)` does NOT narrow the type — `e.builder` right
 * after is a compile error. The two functions below perform the same
 * filter, written as type predicates so the test bodies can read each
 * event type's own fields directly.
 */
type Created = Extract<Event, { k: 'COROUTINE_CREATED' }>
type Propagated = Extract<Event, { k: 'FAILURE_PROPAGATED' }>
type StateEv = Extract<Event, { k: 'JOB_STATE' }>
const createdOf = (events: readonly Event[]): Created[] =>
  events.filter((e): e is Created => e.k === 'COROUTINE_CREATED')
const propagatedOf = (events: readonly Event[]): Propagated[] =>
  events.filter((e): e is Propagated => e.k === 'FAILURE_PROPAGATED')
const statesOf = (events: readonly Event[]): StateEv[] =>
  events.filter((e): e is StateEv => e.k === 'JOB_STATE')

/**
 * Every (parent, child) pair where the child was CREATED while the parent
 * was ALREADY in an end state, along with the child's final state.
 *
 * This is a trace shape real Kotlin never produces: attaching a new
 * coroutine to an already-dead Job kills it before its body gets a chance
 * to run, so the child NEVER reaches 'Completed'. Compared by `seq`, not by
 * the parent's final state: the parent dying AFTER spawning the child is
 * normal and valid (a sibling failing drags the whole family down), only
 * "died BEFORE spawning" is the impossible case.
 */
function childrenBornUnderDeadParent(
  events: readonly Event[],
): { parent: string; child: string; childFinal: string }[] {
  const diedAt = new Map<string, number>()
  for (const e of statesOf(events)) {
    if ((e.to === 'Cancelled' || e.to === 'Completed') && !diedAt.has(e.id)) diedAt.set(e.id, e.seq)
  }
  const finalOf = (id: string): string => {
    const own = statesOf(events).filter(e => e.id === id)
    return own.length > 0 ? own[own.length - 1]!.to : 'New'
  }
  const out: { parent: string; child: string; childFinal: string }[] = []
  for (const c of createdOf(events)) {
    if (c.parentId === null) continue
    const d = diedAt.get(c.parentId)
    if (d !== undefined && d < c.seq) {
      out.push({ parent: c.parentId, child: c.id, childFinal: finalOf(c.id) })
    }
  }
  return out
}

describe('CoroutineScope(ctx) is a real root Job', () => {
  it('scope.launch is a CHILD of the scope, not an orphan job', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(10) }
    delay(100)
}`)
    const created = createdOf(r.events)
    const scope = created.find(e => e.builder === 'scope')!
    expect(scope).toBeDefined()
    expect(scope.parentId).toBeNull()
    expect(scope.ctx.isSupervisor).toBe(true)
    const child = created.find(e => e.builder === 'launch')!
    expect(child.parentId).toBe(scope.id)
  })

  it("the scope's SupervisorJob BLOCKS a child's failure, siblings stay alive", () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { throw RuntimeException("boom") }
    scope.launch { delay(300); println("B still alive") }
    delay(500)
    println("main done")
}`)
    expect(r.output).toEqual(['B still alive', 'main done'])
    // There must be a REAL supervisor boundary on the trace, not "survived
    // because there's no parent-child relationship at all".
    const blocked = propagatedOf(r.events).filter(e => e.blockedBySupervisor)
    expect(blocked.length).toBeGreaterThan(0)
  })

  it("an ordinary Job() (not a supervisor): one child failing drags its sibling down too", () => {
    // The control case for the one above. An implementation like "the
    // scope is always a supervisor" would pass the case above but fail
    // this one.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(Job())
    scope.launch { delay(50); throw RuntimeException("boom") }
    scope.launch { delay(300); println("B should not print") }
    delay(500)
    println("main done")
}`)
    expect(r.output).toEqual(['main done'])
  })

  it('GlobalScope STILL has no parent — completely unlike CoroutineScope', () => {
    // Guards a distinction that's already correct. If someone "unified"
    // these two paths, the "GlobalScope escapes structured concurrency"
    // lesson would disappear.
    const r = runSource(`fun main() = runBlocking {
    GlobalScope.launch { delay(10) }
    delay(100)
}`)
    const created = createdOf(r.events)
    expect(created.some(e => e.builder === 'scope')).toBe(false)
    const child = created.find(e => e.builder === 'launch')!
    expect(child.parentId).toBeNull()
  })

  it('scope.cancel() cancels every child', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(1000); println("A should not print") }
    scope.launch { delay(1000); println("B should not print") }
    delay(50)
    scope.cancel()
    delay(2000)
    println("done")
}`)
    expect(r.output).toEqual(['done'])
  })

  it('MainScope() is also a root Job, and it is a SUPERVISOR — not just a Dispatchers.Main holder', () => {
    // `MainScope()` is the second classic Android pattern (after
    // `CoroutineScope(SupervisorJob() + Dispatchers.Main)`). Verified
    // against real Kotlin: `MainScope().coroutineContext[Job]` prints
    // `SupervisorJobImpl{Active}` and the interceptor is `Dispatchers.Main`.
    // Before Task 5, the engine only carried Dispatchers.Main across, so
    // dropping the SupervisorJob half would build an ORDINARY root Job, and
    // one child failing would kill the whole scope — teaching the exact
    // opposite of this pattern.
    const r = runSource(`fun main() = runBlocking {
    val scope = MainScope()
    scope.launch { delay(10) }
    delay(100)
}`)
    const created = createdOf(r.events)
    const scope = created.find(e => e.builder === 'scope')!
    expect(scope).toBeDefined()
    expect(scope.ctx.isSupervisor).toBe(true)
    expect(scope.ctx.dispatcher).toBe('Main')
    const child = created.find(e => e.builder === 'launch')!
    expect(child.parentId).toBe(scope.id)
    expect(child.ctx.dispatcher).toBe('Main')
  })

  it('an already-cancelled scope: a subsequent launch does NOT run its body, the job is born already cancelled', () => {
    // Verified against real Kotlin (2.1.20), this exact program:
    //   isCancelled=true / isActive=false / done
    // The lambda body prints NOTHING. Attaching a new coroutine to an
    // already-cancelled Job cancels it before the body gets a chance to
    // run — this is exactly why Kotlin needs `withContext(NonCancellable)`
    // for cleanup work.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(Job())
    scope.cancel()
    val j = scope.launch { println("SHOULD-NOT-PRINT") }
    println("isCancelled=" + j.isCancelled)
    println("isActive=" + j.isActive)
    delay(50)
    println("done")
}`)
    expect(r.output).toEqual(['isCancelled=true', 'isActive=false', 'done'])

    // And the trace shape must be something Kotlin could actually produce.
    // Before this guard, the engine drew a 'Cancelled' parent node
    // containing a 'Completed' child node — impossible in Kotlin, and the
    // UI drew exactly that onto the screen.
    const underDeadParent = childrenBornUnderDeadParent(r.events)
    expect(underDeadParent.length).toBeGreaterThan(0) // this program MUST have that case...
    expect(underDeadParent.filter(x => x.childFinal === 'Completed')).toEqual([]) // ...and no child should be Completed
  })

  it('control case: a scope that has NOT been cancelled still runs launch normally', () => {
    // If the guard were overzealous — "every child of a scope is
    // cancelled" — the case above would still pass, and only this one
    // would fail.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(Job())
    val j = scope.launch { println("DOES-RUN") }
    delay(50)
    println("isCancelled=" + j.isCancelled)
    println("done")
}`)
    expect(r.output).toEqual(['DOES-RUN', 'isCancelled=false', 'done'])
  })

  it('a scope root NEVER transitions to an end state on its own when nobody cancels it', () => {
    // Pins down directly the "a scope lives until it's cancelled"
    // semantics (spec Step 5). Without this case, a scope root
    // auto-Completing would only be caught indirectly via the
    // `scope.cancel() cancels every child` case, and caught for an
    // unrelated reason.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(10); println("child done") }
    delay(100)
    println("done")
}`)
    expect(r.output).toEqual(['child done', 'done'])
    const scope = createdOf(r.events).find(e => e.builder === 'scope')!
    const scopeStates = statesOf(r.events).filter(e => e.id === scope.id)
    // It was created and went Active — otherwise the assertion below would be vacuous.
    expect(scopeStates.map(e => e.to)).toEqual(['Active'])
    // Its child DOES reach Completed: proving the program actually ran to
    // completion, and the scope root staying put isn't just because the
    // trace got cut short.
    const child = createdOf(r.events).find(e => e.builder === 'launch')!
    expect(statesOf(r.events).some(e => e.id === child.id && e.to === 'Completed')).toBe(true)
  })

  it("the scope context's dispatcher propagates down to the child", () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))
    scope.launch { delay(10) }
    delay(100)
}`)
    const child = createdOf(r.events).find(e => e.builder === 'launch')!
    expect(child.ctx.dispatcher).toBe('IO')
    expect(child.ctx.name).toBe('worker')
  })
})
