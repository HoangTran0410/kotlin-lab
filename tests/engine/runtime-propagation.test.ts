import { describe, expect, it } from 'vitest'
import { Job } from '../../src/engine/runtime/job'
import { cancelJob, reportFailure } from '../../src/engine/runtime/propagation'
import { TraceEmitter } from '../../src/engine/trace/emitter'

const boom = { exType: 'RuntimeException', message: 'boom', isCancellation: false }
const cancelled = { exType: 'CancellationException', message: 'cancelled', isCancellation: true }

/** parent + 3 children, all Active. */
function tree(supervisor: boolean) {
  const p = new Job('p', 'Parent', null, supervisor)
  p.transitionTo('Active')
  const kids = ['a', 'b', 'c'].map(id => {
    const j = new Job(id, id.toUpperCase(), p, false)
    j.transitionTo('Active')
    p.addChild(j)
    return j
  })
  return { p, a: kids[0]!, b: kids[1]!, c: kids[2]! }
}

describe('propagation — cancel goes down', () => {
  it('cancelling the parent makes every child Cancelled', () => {
    const { p, a, b, c } = tree(false)
    cancelJob(p, cancelled, new TraceEmitter(), 'user')
    expect([p.state, a.state, b.state, c.state]).toEqual(
      ['Cancelled', 'Cancelled', 'Cancelled', 'Cancelled'])
  })

  it('cancellation reaches grandchildren, not just direct children', () => {
    const { p, a } = tree(false)
    const g = new Job('g', 'G', a, false); g.transitionTo('Active'); a.addChild(g)
    cancelJob(p, cancelled, new TraceEmitter(), 'user')
    expect(g.state).toBe('Cancelled')
  })

  it('emits CANCEL_REQUESTED for the cancelled job itself, then for each child', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const evs = em.events.filter(e => e.k === 'CANCEL_REQUESTED')
    expect(evs.map(e => [(e as { from: string }).from, (e as { to: string }).to])).toEqual([
      ['user', 'p'], ['p', 'a'], ['p', 'b'], ['p', 'c'],
    ])
  })

  it('does not emit a duplicate CANCEL_REQUESTED for the same job', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const targets = em.events.filter(e => e.k === 'CANCEL_REQUESTED').map(e => (e as { to: string }).to)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('cancelling an already-Completed job does not error', () => {
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active'); j.transitionTo('Completed')
    expect(() => cancelJob(j, cancelled, new TraceEmitter(), 'user')).not.toThrow()
    expect(j.state).toBe('Completed')
  })

  it('emits both JOB_STATE legs Active->Cancelling->Cancelled', () => {
    // The UI draws the Cancelling leg; jumping straight to Cancelled would
    // drop a step of the animation and the learner would never see the
    // "being cancelled" phase.
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active')
    const em = new TraceEmitter()
    cancelJob(j, cancelled, em, 'user')
    const states = em.events
      .filter(e => e.k === 'JOB_STATE')
      .map(e => [(e as { from: string }).from, (e as { to: string }).to])
    expect(states).toEqual([['Active', 'Cancelling'], ['Cancelling', 'Cancelled']])
  })

  it('children are cancelled BEFORE the parent — this is the order the UI draws', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const order = em.events
      .filter(e => e.k === 'JOB_STATE' && (e as { to: string }).to === 'Cancelled')
      .map(e => (e as { id: string }).id)
    expect(order).toEqual(['a', 'b', 'c', 'p'])
  })
})

describe('propagation — failure goes up', () => {
  it('child failure makes an ordinary parent FAIL', () => {
    const { p, b } = tree(false)
    reportFailure(b, boom, new TraceEmitter())
    expect(p.state).toBe('Cancelled')
    expect(p.cause?.exType).toBe('RuntimeException')
  })

  it('parent fails then cancels its siblings', () => {
    const { a, b, c } = tree(false)
    reportFailure(b, boom, new TraceEmitter())
    expect([a.state, c.state]).toEqual(['Cancelled', 'Cancelled'])
  })

  it('emits FAILURE_PROPAGATED with blockedBySupervisor false', () => {
    const { b } = tree(false)
    const em = new TraceEmitter()
    reportFailure(b, boom, em)
    const ev = em.events.find(e => e.k === 'FAILURE_PROPAGATED')
    expect(ev).toMatchObject({ from: 'b', to: 'p', blockedBySupervisor: false })
  })

  it('CancellationException does NOT fail the parent', () => {
    const { p, a, c } = tree(false)
    const b = new Job('b2', 'B2', p, false); b.transitionTo('Active'); p.addChild(b)
    reportFailure(b, cancelled, new TraceEmitter())
    expect([p.state, a.state, c.state]).toEqual(['Active', 'Active', 'Active'])
  })
})

describe('propagation — supervisor boundary', () => {
  it('a supervisor does NOT fail when a direct child fails', () => {
    const { p, b } = tree(true)
    reportFailure(b, boom, new TraceEmitter())
    expect(p.state).toBe('Active')
  })

  it('siblings stay Active when the supervisor blocks the failure', () => {
    const { a, c, b } = tree(true)
    reportFailure(b, boom, new TraceEmitter())
    expect([a.state, c.state]).toEqual(['Active', 'Active'])
  })

  it('emits FAILURE_PROPAGATED with blockedBySupervisor true', () => {
    const { b } = tree(true)
    const em = new TraceEmitter()
    reportFailure(b, boom, em)
    expect(em.events.find(e => e.k === 'FAILURE_PROPAGATED'))
      .toMatchObject({ from: 'b', to: 'p', blockedBySupervisor: true })
  })

  it('TRAP: a supervisor only blocks its direct child — a grandchild still follows ordinary Job rules', () => {
    // root(supervisor) -> P(ordinary) -> A, B, C
    const root = new Job('root', 'Root', null, true); root.transitionTo('Active')
    const P = new Job('P', 'P', root, false); P.transitionTo('Active'); root.addChild(P)
    const kids = ['A', 'B', 'C'].map(id => {
      const j = new Job(id, id, P, false); j.transitionTo('Active'); P.addChild(j); return j
    })
    reportFailure(kids[1]!, boom, new TraceEmitter())
    expect(P.state).toBe('Cancelled')          // P is ordinary -> fails
    expect(kids[0]!.state).toBe('Cancelled')   // sibling dragged down with it
    expect(kids[2]!.state).toBe('Cancelled')
    expect(root.state).toBe('Active')          // but the root supervisor survives
  })

  it('a root failure (no parent) still records a cause', () => {
    const j = new Job('j', 'J', null, false); j.transitionTo('Active')
    reportFailure(j, boom, new TraceEmitter())
    expect(j.cause?.exType).toBe('RuntimeException')
  })

  it('failure climbs MULTIPLE LEVELS when every parent is an ordinary Job', () => {
    // R -> P -> B, and R has another child U (B's uncle).
    // An implementation that only propagates one level would leave R and U
    // alive — flat-out wrong compared to Kotlin.
    const R = new Job('R', 'R', null, false); R.transitionTo('Active')
    const P = new Job('P', 'P', R, false); P.transitionTo('Active'); R.addChild(P)
    const U = new Job('U', 'U', R, false); U.transitionTo('Active'); R.addChild(U)
    const B = new Job('B', 'B', P, false); B.transitionTo('Active'); P.addChild(B)

    reportFailure(B, boom, new TraceEmitter())

    expect(P.state).toBe('Cancelled')
    expect(R.state).toBe('Cancelled')  // one-level-only would leave this Active
    expect(U.state).toBe('Cancelled')  // the uncle gets dragged down too
  })

  it('nested supervisor trap: failure must REACH the boundary and get recorded', () => {
    // If propagation only went one level, the P -> root event would never be
    // emitted, and the UI would have nothing to draw the supervisor boundary
    // with — the whole lesson would be lost.
    const root = new Job('root', 'Root', null, true); root.transitionTo('Active')
    const P = new Job('P', 'P', root, false); P.transitionTo('Active'); root.addChild(P)
    const B = new Job('B', 'B', P, false); B.transitionTo('Active'); P.addChild(B)

    const em = new TraceEmitter()
    reportFailure(B, boom, em)

    const props = em.events
      .filter(e => e.k === 'FAILURE_PROPAGATED')
      .map(e => [
        (e as { from: string }).from,
        (e as { to: string }).to,
        (e as { blockedBySupervisor: boolean }).blockedBySupervisor,
      ])
    expect(props).toEqual([['B', 'P', false], ['P', 'root', true]])
    expect(root.state).toBe('Active')
  })

  it('a deeply nested CancellationException still does not drag any ancestor down', () => {
    const R = new Job('R', 'R', null, false); R.transitionTo('Active')
    const P = new Job('P', 'P', R, false); P.transitionTo('Active'); R.addChild(P)
    const B = new Job('B', 'B', P, false); B.transitionTo('Active'); P.addChild(B)

    reportFailure(B, cancelled, new TraceEmitter())

    expect([R.state, P.state]).toEqual(['Active', 'Active'])
    expect(B.state).toBe('Cancelled')
  })
})
