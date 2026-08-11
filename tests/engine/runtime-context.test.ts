import { describe, expect, it } from 'vitest'
import { CoroutineContext } from '../../src/engine/runtime/context'
import { Job } from '../../src/engine/runtime/job'

describe('CoroutineContext', () => {
  it('rỗng thì dispatcher mặc định là Default', () => {
    expect(CoroutineContext.empty().dispatcher).toBe('Default')
  })

  it('plus ghi đè element cùng loại, bên phải thắng', () => {
    const a = CoroutineContext.empty().withDispatcher('IO')
    const b = CoroutineContext.empty().withDispatcher('Main')
    expect(a.plus(b).dispatcher).toBe('Main')
  })

  it('plus giữ element mà bên phải không có', () => {
    const a = CoroutineContext.empty().withName('worker')
    const b = CoroutineContext.empty().withDispatcher('IO')
    const c = a.plus(b)
    expect({ name: c.name, dispatcher: c.dispatcher }).toEqual({ name: 'worker', dispatcher: 'IO' })
  })

  it('mang được Job', () => {
    const j = new Job('j1', 'j1', null, true)
    expect(CoroutineContext.empty().withJob(j).job).toBe(j)
  })

  it('summary phản ánh supervisor và handler', () => {
    const j = new Job('j1', 'j1', null, true)
    const ctx = CoroutineContext.empty().withJob(j).withHandler('h').withName('w').withDispatcher('IO')
    expect(ctx.summary()).toEqual({
      dispatcher: 'IO', name: 'w', isSupervisor: true, hasHandler: true,
    })
  })

  it('plus không làm thay đổi context gốc', () => {
    const a = CoroutineContext.empty().withDispatcher('IO')
    a.plus(CoroutineContext.empty().withDispatcher('Main'))
    expect(a.dispatcher).toBe('IO')
  })
})
