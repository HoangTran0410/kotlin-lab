import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('Job lifecycle — Active immediately upon creation (CoroutineStart.DEFAULT)', () => {
  it('a job is Active right after launch, before its body has run a single line', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    println(job.isActive)
    println(job.isCompleted)
    println(job.isCancelled)
    job.join()
    println(job.isActive)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['true', 'false', 'false', 'false', 'true'])
  })

  it('same for async', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(10); 1 }
    println(d.isActive)
    d.await()
    println(d.isActive)
}`)
    expect(r.output).toEqual(['true', 'false'])
  })

  it('JOB_STATE New->Active sits RIGHT AFTER the COROUTINE_CREATED of the same job', () => {
    // Asserts on the shape of the trace, not just an observable value: an
    // implementation that makes `isActive` lie (returning true while state
    // is still New) would still pass the two cases above but fail this one.
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const i = r.events.findIndex(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')
    const next = r.events[i + 1]!
    expect(next.k).toBe('JOB_STATE')
    expect(next).toMatchObject({ from: 'New', to: 'Active' })
  })

  it('COROUTINE_STARTED is still emitted LATER, on the first run — Active differs from has-run', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const active = r.events.findIndex(e => e.k === 'JOB_STATE' && e.to === 'Active' && e.id !== 'j1')
    const started = r.events.findIndex(e => e.k === 'COROUTINE_STARTED' && e.id !== 'j1')
    expect(active).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(active)
  })

  it('no JOB_STATE ever transitions to Active TWICE for the same job', () => {
    // Guards against the easiest mistake to make when touching this: adding
    // the creation-time transition while forgetting to remove the old one in
    // step().
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    launch { delay(20) }
    delay(50)
}`)
    const count = new Map<string, number>()
    for (const e of r.events) {
      if (e.k === 'JOB_STATE' && e.to === 'Active') count.set(e.id, (count.get(e.id) ?? 0) + 1)
    }
    for (const [id, n] of count) expect(n, `job ${id} entered Active ${n} times`).toBe(1)
  })

  it('cancelling a job that has NEVER run is still correct: Cancelled, not stuck at New', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(1000); println("not printed") }
    job.cancel()
    println(job.isCancelled)
    delay(50)
}`)
    expect(r.output).toEqual(['true'])
  })
})
