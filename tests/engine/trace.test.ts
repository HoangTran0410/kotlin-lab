import { describe, expect, it } from 'vitest'
import { TraceEmitter } from '../../src/engine/trace/emitter'
import { foldTrace } from '../../src/engine/trace/world'

const sample = () => {
  const em = new TraceEmitter()
  em.emit({ k: 'COROUTINE_CREATED', id: 'j1', parentId: null, builder: 'runBlocking',
    ctx: { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false } })
  em.emit({ k: 'JOB_STATE', id: 'j1', from: 'New', to: 'Active' })
  em.setClock(100)
  em.emit({ k: 'PRINTLN', id: 'j1', text: 'hi' })
  em.emit({ k: 'JOB_STATE', id: 'j1', from: 'Active', to: 'Completed' })
  return em.events
}

describe('trace', () => {
  it('seq increases monotonically from 0', () => {
    expect(sample().map(e => e.seq)).toEqual([0, 1, 2, 3])
  })

  it('t is taken from the virtual clock at the moment of emit', () => {
    expect(sample().map(e => e.t)).toEqual([0, 0, 100, 100])
  })

  it('fold builds the correct job state at the last step', () => {
    const w = foldTrace(sample(), 4)
    expect(w.jobs.get('j1')).toMatchObject({ state: 'Completed', builder: 'runBlocking' })
  })

  it('fold up to a middle step gives an intermediate state', () => {
    const w = foldTrace(sample(), 2)
    expect(w.jobs.get('j1')!.state).toBe('Active')
    expect(w.output).toEqual([])
  })

  it('println output accumulates in order', () => {
    expect(foldTrace(sample(), 4).output).toEqual(['hi'])
  })

  it('fold is a pure function — does not depend on previous calls', () => {
    const evs = sample()
    // Must capture a DEEP CLONE before calling anything that could corrupt
    // state. If we only kept a reference, a stateful foldTrace (WorldState
    // hoisted to module scope) would change this variable along with it, and
    // the final comparison would degenerate into x === x — always true,
    // detecting nothing.
    const straightToTwo = structuredClone(foldTrace(evs, 2))
    foldTrace(evs, evs.length)
    expect(foldTrace(evs, 2)).toEqual(straightToTwo)
  })

  it('every call returns a NEW object, never reuses old state', () => {
    // This is the test that actually catches the regression above: it
    // compares by reference, which toEqual can never see.
    const evs = sample()
    const a = foldTrace(evs, 2)
    const b = foldTrace(evs, 2)
    expect(a).not.toBe(b)
    expect(a.jobs).not.toBe(b.jobs)
    expect(a.output).not.toBe(b.output)
    expect(a).toEqual(b)
  })

  it('foldTrace does not mutate the input event array', () => {
    const evs = sample()
    const before = structuredClone(evs)
    foldTrace(evs, evs.length)
    expect(evs).toEqual(before)
  })

  it('upTo beyond the array length clamps to the last step', () => {
    const evs = sample()
    expect(foldTrace(evs, 999)).toEqual(foldTrace(evs, evs.length))
  })

  it('negative upTo gives empty state', () => {
    const w = foldTrace(sample(), -5)
    expect({ jobs: w.jobs.size, output: w.output }).toEqual({ jobs: 0, output: [] })
  })
})
