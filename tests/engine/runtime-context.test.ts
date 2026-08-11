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

  it('vế phải KHÔNG đặt dispatcher thì giữ nguyên của vế trái', () => {
    // ĐÂY là lý do tồn tại của việc lưu element dạng T|null. Một bản cài đặt
    // gộp "chưa đặt" với giá trị mặc định 'Default' sẽ reset IO về Default ở
    // đây — mà vẫn pass mọi test khác, vì các test kia đều đặt dispatcher
    // tường minh ở vế phải.
    const ctx = CoroutineContext.empty().withDispatcher('IO')
      .plus(CoroutineContext.empty().withName('worker'))
    expect(ctx.dispatcher).toBe('IO')
    expect(ctx.name).toBe('worker')
  })

  it("đặt 'Default' TƯỜNG MINH ở vế phải vẫn ghi đè được IO", () => {
    // 'Default' là giá trị miền hợp lệ, khác hẳn với "chưa đặt" (null).
    const ctx = CoroutineContext.empty().withDispatcher('IO')
      .plus(CoroutineContext.empty().withDispatcher('Default'))
    expect(ctx.dispatcher).toBe('Default')
  })

  it('plus giữ job và handler khi vế phải không đặt', () => {
    const j = new Job('j1', 'j1', null, false)
    const ctx = CoroutineContext.empty().withJob(j).withHandler('CEH')
      .plus(CoroutineContext.empty().withName('w'))
    expect(ctx.job).toBe(j)
    expect(ctx.handler).toBe('CEH')
  })

  it('summary của context rỗng: không supervisor, không handler', () => {
    expect(CoroutineContext.empty().summary()).toEqual({
      dispatcher: 'Default', name: null, isSupervisor: false, hasHandler: false,
    })
  })
})
