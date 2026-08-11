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
    // Phải chụp BẢN SAO SÂU trước khi gọi cái có thể làm hỏng state.
    // Nếu chỉ giữ tham chiếu thì một foldTrace stateful (hoist WorldState ra
    // module scope) sẽ khiến biến này thay đổi theo, và phép so sánh cuối
    // suy biến thành x === x — luôn đúng, không phát hiện được gì.
    const straightToTwo = structuredClone(foldTrace(evs, 2))
    foldTrace(evs, evs.length)
    expect(foldTrace(evs, 2)).toEqual(straightToTwo)
  })

  it('mỗi lần gọi trả về đối tượng MỚI, không dùng lại state cũ', () => {
    // Đây mới là test thực sự chặn được kiểu hồi quy nói trên: so sánh
    // tham chiếu, thứ mà toEqual không bao giờ nhìn thấy.
    const evs = sample()
    const a = foldTrace(evs, 2)
    const b = foldTrace(evs, 2)
    expect(a).not.toBe(b)
    expect(a.jobs).not.toBe(b.jobs)
    expect(a.output).not.toBe(b.output)
    expect(a).toEqual(b)
  })

  it('foldTrace không làm thay đổi mảng event đầu vào', () => {
    const evs = sample()
    const before = structuredClone(evs)
    foldTrace(evs, evs.length)
    expect(evs).toEqual(before)
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
