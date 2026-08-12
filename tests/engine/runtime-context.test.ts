import { describe, expect, it } from 'vitest'
import { CoroutineContext } from '../../src/engine/runtime/context'
import { Job } from '../../src/engine/runtime/job'

describe('CoroutineContext', () => {
  it('an empty context defaults its dispatcher to Default', () => {
    expect(CoroutineContext.empty().dispatcher).toBe('Default')
  })

  it('plus overrides an element of the same kind, right-hand side wins', () => {
    const a = CoroutineContext.empty().withDispatcher('IO')
    const b = CoroutineContext.empty().withDispatcher('Main')
    expect(a.plus(b).dispatcher).toBe('Main')
  })

  it("plus keeps an element the right-hand side doesn't have", () => {
    const a = CoroutineContext.empty().withName('worker')
    const b = CoroutineContext.empty().withDispatcher('IO')
    const c = a.plus(b)
    expect({ name: c.name, dispatcher: c.dispatcher }).toEqual({ name: 'worker', dispatcher: 'IO' })
  })

  it('can carry a Job', () => {
    const j = new Job('j1', 'j1', null, true)
    expect(CoroutineContext.empty().withJob(j).job).toBe(j)
  })

  it('summary reflects supervisor and handler', () => {
    const j = new Job('j1', 'j1', null, true)
    const ctx = CoroutineContext.empty().withJob(j).withHandler('h').withName('w').withDispatcher('IO')
    expect(ctx.summary()).toEqual({
      dispatcher: 'IO', name: 'w', isSupervisor: true, hasHandler: true,
    })
  })

  it('plus does not mutate the original context', () => {
    const a = CoroutineContext.empty().withDispatcher('IO')
    a.plus(CoroutineContext.empty().withDispatcher('Main'))
    expect(a.dispatcher).toBe('IO')
  })

  it('when the right-hand side does NOT set a dispatcher, the left-hand one is kept', () => {
    // THIS is the reason elements are stored as T|null. An implementation
    // that conflates "not set" with the default value 'Default' would reset
    // IO back to Default here — while still passing every other test, since
    // those all set the dispatcher explicitly on the right-hand side.
    const ctx = CoroutineContext.empty().withDispatcher('IO')
      .plus(CoroutineContext.empty().withName('worker'))
    expect(ctx.dispatcher).toBe('IO')
    expect(ctx.name).toBe('worker')
  })

  it("setting 'Default' EXPLICITLY on the right-hand side still overrides IO", () => {
    // 'Default' is a valid value in the domain, completely different from "not set" (null).
    const ctx = CoroutineContext.empty().withDispatcher('IO')
      .plus(CoroutineContext.empty().withDispatcher('Default'))
    expect(ctx.dispatcher).toBe('Default')
  })

  it("plus keeps job and handler when the right-hand side doesn't set them", () => {
    const j = new Job('j1', 'j1', null, false)
    const ctx = CoroutineContext.empty().withJob(j).withHandler('CEH')
      .plus(CoroutineContext.empty().withName('w'))
    expect(ctx.job).toBe(j)
    expect(ctx.handler).toBe('CEH')
  })

  it('summary of an empty context: no supervisor, no handler', () => {
    expect(CoroutineContext.empty().summary()).toEqual({
      dispatcher: 'Default', name: null, isSupervisor: false, hasHandler: false,
    })
  })
})
