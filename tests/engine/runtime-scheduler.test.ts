import { describe, expect, it } from 'vitest'
import { Scheduler } from '../../src/engine/runtime/scheduler'
import type { VoidCoroutineBody } from '../../src/engine/runtime/suspension'

const collectPrints = (s: Scheduler) =>
  s.emitter.events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text)

describe('Scheduler', () => {
  it('runs a single coroutine with no suspend', () => {
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): VoidCoroutineBody { s.println('hi') })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['hi'])
    expect(root.state).toBe('Completed')
  })

  it('delay advances the virtual clock, does not really sleep', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody {
      yield { s: 'delay', ms: 1000 }
      s.println('after delay')
    })
    const start = Date.now()
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['after delay'])
    expect(s.clock.now).toBe(1000)
    expect(Date.now() - start).toBeLessThan(200) // does not really sleep
  })

  it('two coroutines interleave according to their delay timing', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody {
      s.spawnChild(function* (): VoidCoroutineBody {
        yield { s: 'delay', ms: 200 }; s.println('B')
      })
      s.spawnChild(function* (): VoidCoroutineBody {
        yield { s: 'delay', ms: 100 }; s.println('A')
      })
      yield { s: 'delay', ms: 300 }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B'])
  })

  it('emits COROUTINE_SUSPENDED then COROUTINE_RESUMED', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 10 } })
    s.runToCompletion()
    const kinds = s.emitter.events.map(e => e.k)
    expect(kinds).toContain('COROUTINE_SUSPENDED')
    expect(kinds).toContain('COROUTINE_RESUMED')
  })

  it('an exception in the coroutine body becomes the Job failure', () => {
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): VoidCoroutineBody {
      throw Object.assign(new Error('boom'), { kotlinType: 'RuntimeException' })
    })
    s.runToCompletion()
    expect(root.state).toBe('Cancelled')
    expect(root.cause?.exType).toBe('RuntimeException')
  })

  it('running the same program again produces an identical trace — deterministic', () => {
    const build = () => {
      const s = new Scheduler()
      s.spawnRoot(function* (): VoidCoroutineBody {
        s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 50 }; s.println('x') })
        s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 50 }; s.println('y') })
        yield { s: 'delay', ms: 100 }
      })
      s.runToCompletion()
      return JSON.stringify(s.emitter.events)
    }
    expect(build()).toBe(build())
  })

  it('runToCompletion stops, no infinite loop when there is nothing left to do', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody { yield { s: 'yield' } })
    s.runToCompletion()
    expect(s.emitter.events.length).toBeGreaterThan(0)
  })

  it('join actually waits for the other job to finish before continuing', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody {
      const child = s.spawnChild(function* (): VoidCoroutineBody {
        yield { s: 'delay', ms: 100 }
        s.println('child done')
      })
      yield { s: 'join', jobId: child.id }
      s.println('after join')
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['child done', 'after join'])
  })

  it('join does NOT block the virtual clock from advancing — deadlock regression guard', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody {
      const child = s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 500 } })
      yield { s: 'join', jobId: child.id }
    })
    s.runToCompletion()
    expect(s.clock.now).toBe(500)
  })

  it('yield puts the coroutine BACK on the queue, does not abandon it', () => {
    // If the 'yield' branch in suspend() were removed outright, the task
    // would be abandoned: 'after' would never print and the job would be
    // stuck at Active forever. No other test catches this, because they
    // only assert on side effects that happen BEFORE the yield point.
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): VoidCoroutineBody {
      s.println('before')
      yield { s: 'yield' }
      s.println('after')
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['before', 'after'])
    expect(root.state).toBe('Completed')
  })

  it('ready is FIFO — several coroutines ready AT THE SAME TIME run in creation order', () => {
    // Every other test uses different delays, so order is decided by the
    // CLOCK and the FIFO-ness of ready is never actually exercised. Here
    // there is no delay at all, so the print order directly exposes the
    // dequeue order: shift -> A,B,C; pop -> C,B,A.
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody {
      s.spawnChild(function* (): VoidCoroutineBody { s.println('A') })
      s.spawnChild(function* (): VoidCoroutineBody { s.println('B') })
      s.spawnChild(function* (): VoidCoroutineBody { s.println('C') })
      yield { s: 'yield' }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'C'])
  })

  // HONEST NOTE: this test does NOT distinguish shift() from pop(). Verified:
  // with pop(), creation order is reversed and then resume order is reversed
  // again, the two reversals cancel out and the result is still A,B,C. It
  // pins down end-to-end behaviour (clock and scheduler agreeing with each
  // other), not queue discipline. The no-delay test above is the one that
  // actually guards FIFO.
  it('same delay deadline still resumes in creation order', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): VoidCoroutineBody {
      s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 100 }; s.println('A') })
      s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 100 }; s.println('B') })
      s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 100 }; s.println('C') })
      yield { s: 'delay', ms: 200 }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'C'])
  })

  it('joinChildren waits for every child, including the slowest one', () => {
    const s = new Scheduler()
    s.spawnRoot(rootJob => (function* (): VoidCoroutineBody {
      s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 100 }; s.println('A') })
      s.spawnChild(function* (): VoidCoroutineBody { yield { s: 'delay', ms: 300 }; s.println('B') })
      yield { s: 'joinChildren', jobId: rootJob.id }
      s.println('scope done')
    })())
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'scope done'])
  })
})
