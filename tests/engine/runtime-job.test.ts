import { describe, expect, it } from 'vitest'
import { Job } from '../../src/engine/runtime/job'

describe('Job state machine', () => {
  it('khởi tạo ở trạng thái New', () => {
    expect(new Job('j1', 'root', null, false).state).toBe('New')
  })

  it('chuyển New -> Active -> Completing -> Completed', () => {
    const j = new Job('j1', 'root', null, false)
    j.transitionTo('Active'); j.transitionTo('Completing'); j.transitionTo('Completed')
    expect(j.state).toBe('Completed')
    expect(j.isCompleted).toBe(true)
  })

  it('chặn chuyển trạng thái không hợp lệ', () => {
    const j = new Job('j1', 'root', null, false)
    j.transitionTo('Active'); j.transitionTo('Completed')
    expect(() => j.transitionTo('Active')).toThrow(/không hợp lệ/)
  })

  it('addChild gắn hai chiều', () => {
    const p = new Job('p', 'parent', null, false)
    const c = new Job('c', 'child', p, false)
    p.addChild(c)
    expect(p.children).toEqual([c])
    expect(c.parent).toBe(p)
  })

  it('children giữ đúng thứ tự thêm — quyết định tính deterministic', () => {
    const p = new Job('p', 'parent', null, false)
    const ids = ['a', 'b', 'c']
    ids.forEach(id => p.addChild(new Job(id, id, p, false)))
    expect(p.children.map(c => c.id)).toEqual(ids)
  })

  it('descendants duyệt theo chiều sâu, thứ tự ổn định', () => {
    const root = new Job('r', 'r', null, false)
    const a = new Job('a', 'a', root, false); root.addChild(a)
    const b = new Job('b', 'b', root, false); root.addChild(b)
    const a1 = new Job('a1', 'a1', a, false); a.addChild(a1)
    expect(root.descendants().map(j => j.id)).toEqual(['a', 'a1', 'b'])
  })

  it('isActive chỉ đúng khi Active', () => {
    const j = new Job('j', 'j', null, false)
    expect(j.isActive).toBe(false)
    j.transitionTo('Active')
    expect(j.isActive).toBe(true)
  })

  it('isCancelled đúng sau khi Cancelled', () => {
    const j = new Job('j', 'j', null, false)
    j.transitionTo('Active'); j.transitionTo('Cancelling'); j.transitionTo('Cancelled')
    expect(j.isCancelled).toBe(true)
    expect(j.isCompleted).toBe(true)
  })
})
