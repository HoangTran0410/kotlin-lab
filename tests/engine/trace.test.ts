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
  it('seq tăng đơn điệu từ 0', () => {
    expect(sample().map(e => e.seq)).toEqual([0, 1, 2, 3])
  })

  it('t lấy theo đồng hồ ảo tại thời điểm phát', () => {
    expect(sample().map(e => e.t)).toEqual([0, 0, 100, 100])
  })

  it('fold dựng đúng trạng thái job tại step cuối', () => {
    const w = foldTrace(sample(), 4)
    expect(w.jobs.get('j1')).toMatchObject({ state: 'Completed', builder: 'runBlocking' })
  })

  it('fold tới step giữa cho trạng thái trung gian', () => {
    const w = foldTrace(sample(), 2)
    expect(w.jobs.get('j1')!.state).toBe('Active')
    expect(w.output).toEqual([])
  })

  it('output println tích luỹ theo thứ tự', () => {
    expect(foldTrace(sample(), 4).output).toEqual(['hi'])
  })

  it('fold là hàm thuần — không phụ thuộc lần gọi trước đó', () => {
    const evs = sample()
    // Tua tới cuối rồi quay về step 2 phải cho đúng kết quả như fold thẳng tới 2.
    // Đây là bất biến cho phép UI tua ngược mà không cần cơ chế undo.
    const straightToTwo = foldTrace(evs, 2)
    foldTrace(evs, evs.length)
    const afterScrubbing = foldTrace(evs, 2)
    expect(afterScrubbing).toEqual(straightToTwo)
  })

  it('upTo vượt quá độ dài thì kẹp về step cuối', () => {
    const evs = sample()
    expect(foldTrace(evs, 999)).toEqual(foldTrace(evs, evs.length))
  })

  it('upTo âm cho trạng thái rỗng', () => {
    const w = foldTrace(sample(), -5)
    expect({ jobs: w.jobs.size, output: w.output }).toEqual({ jobs: 0, output: [] })
  })
})
