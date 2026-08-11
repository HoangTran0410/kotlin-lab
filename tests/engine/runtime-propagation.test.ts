import { describe, expect, it } from 'vitest'
import { Job } from '../../src/engine/runtime/job'
import { cancelJob, reportFailure } from '../../src/engine/runtime/propagation'
import { TraceEmitter } from '../../src/engine/trace/emitter'

const boom = { exType: 'RuntimeException', message: 'boom', isCancellation: false }
const cancelled = { exType: 'CancellationException', message: 'cancelled', isCancellation: true }

/** parent + 3 con, tất cả Active. */
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

describe('propagation — cancel đi xuống', () => {
  it('cancel parent làm mọi child Cancelled', () => {
    const { p, a, b, c } = tree(false)
    cancelJob(p, cancelled, new TraceEmitter(), 'user')
    expect([p.state, a.state, b.state, c.state]).toEqual(
      ['Cancelled', 'Cancelled', 'Cancelled', 'Cancelled'])
  })

  it('cancel lan tới cháu, không chỉ con trực tiếp', () => {
    const { p, a } = tree(false)
    const g = new Job('g', 'G', a, false); g.transitionTo('Active'); a.addChild(g)
    cancelJob(p, cancelled, new TraceEmitter(), 'user')
    expect(g.state).toBe('Cancelled')
  })

  it('phát CANCEL_REQUESTED cho chính job bị cancel rồi tới từng child', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const evs = em.events.filter(e => e.k === 'CANCEL_REQUESTED')
    expect(evs.map(e => [(e as { from: string }).from, (e as { to: string }).to])).toEqual([
      ['user', 'p'], ['p', 'a'], ['p', 'b'], ['p', 'c'],
    ])
  })

  it('không phát CANCEL_REQUESTED trùng cho cùng một job', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const targets = em.events.filter(e => e.k === 'CANCEL_REQUESTED').map(e => (e as { to: string }).to)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('cancel job đã Completed không gây lỗi', () => {
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active'); j.transitionTo('Completed')
    expect(() => cancelJob(j, cancelled, new TraceEmitter(), 'user')).not.toThrow()
    expect(j.state).toBe('Completed')
  })

  it('phát JOB_STATE đủ hai chặng Active->Cancelling->Cancelled', () => {
    // UI vẽ chặng Cancelling; nếu nhảy thẳng sang Cancelled thì mất một bước
    // của hoạt cảnh và người học không thấy được giai đoạn "đang huỷ".
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active')
    const em = new TraceEmitter()
    cancelJob(j, cancelled, em, 'user')
    const states = em.events
      .filter(e => e.k === 'JOB_STATE')
      .map(e => [(e as { from: string }).from, (e as { to: string }).to])
    expect(states).toEqual([['Active', 'Cancelling'], ['Cancelling', 'Cancelled']])
  })

  it('con bị cancel TRƯỚC cha — thứ tự này là thứ tự UI vẽ', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const order = em.events
      .filter(e => e.k === 'JOB_STATE' && (e as { to: string }).to === 'Cancelled')
      .map(e => (e as { id: string }).id)
    expect(order).toEqual(['a', 'b', 'c', 'p'])
  })
})

describe('propagation — failure đi lên', () => {
  it('child fail làm parent thường FAIL', () => {
    const { p, b } = tree(false)
    reportFailure(b, boom, new TraceEmitter())
    expect(p.state).toBe('Cancelled')
    expect(p.cause?.exType).toBe('RuntimeException')
  })

  it('parent fail rồi cancel các sibling', () => {
    const { a, b, c } = tree(false)
    reportFailure(b, boom, new TraceEmitter())
    expect([a.state, c.state]).toEqual(['Cancelled', 'Cancelled'])
  })

  it('phát FAILURE_PROPAGATED với blockedBySupervisor false', () => {
    const { b } = tree(false)
    const em = new TraceEmitter()
    reportFailure(b, boom, em)
    const ev = em.events.find(e => e.k === 'FAILURE_PROPAGATED')
    expect(ev).toMatchObject({ from: 'b', to: 'p', blockedBySupervisor: false })
  })

  it('CancellationException KHÔNG làm parent fail', () => {
    const { p, a, c } = tree(false)
    const b = new Job('b2', 'B2', p, false); b.transitionTo('Active'); p.addChild(b)
    reportFailure(b, cancelled, new TraceEmitter())
    expect([p.state, a.state, c.state]).toEqual(['Active', 'Active', 'Active'])
  })
})

describe('propagation — supervisor boundary', () => {
  it('supervisor KHÔNG fail khi direct child fail', () => {
    const { p, b } = tree(true)
    reportFailure(b, boom, new TraceEmitter())
    expect(p.state).toBe('Active')
  })

  it('sibling vẫn Active khi supervisor chặn failure', () => {
    const { a, c, b } = tree(true)
    reportFailure(b, boom, new TraceEmitter())
    expect([a.state, c.state]).toEqual(['Active', 'Active'])
  })

  it('phát FAILURE_PROPAGATED với blockedBySupervisor true', () => {
    const { b } = tree(true)
    const em = new TraceEmitter()
    reportFailure(b, boom, em)
    expect(em.events.find(e => e.k === 'FAILURE_PROPAGATED'))
      .toMatchObject({ from: 'b', to: 'p', blockedBySupervisor: true })
  })

  it('BẪY: supervisor chỉ chắn direct child — cháu vẫn theo luật Job thường', () => {
    // root(supervisor) -> P(thường) -> A, B, C
    const root = new Job('root', 'Root', null, true); root.transitionTo('Active')
    const P = new Job('P', 'P', root, false); P.transitionTo('Active'); root.addChild(P)
    const kids = ['A', 'B', 'C'].map(id => {
      const j = new Job(id, id, P, false); j.transitionTo('Active'); P.addChild(j); return j
    })
    reportFailure(kids[1]!, boom, new TraceEmitter())
    expect(P.state).toBe('Cancelled')          // P thường -> fail
    expect(kids[0]!.state).toBe('Cancelled')   // sibling bị kéo theo
    expect(kids[2]!.state).toBe('Cancelled')
    expect(root.state).toBe('Active')          // nhưng supervisor gốc vẫn sống
  })

  it('root fail (không có parent) vẫn ghi nhận cause', () => {
    const j = new Job('j', 'J', null, false); j.transitionTo('Active')
    reportFailure(j, boom, new TraceEmitter())
    expect(j.cause?.exType).toBe('RuntimeException')
  })
})
