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

  it('isCompleted KHÁC !isActive — job mới tạo (New) cả hai đều false', () => {
    // Task 19 làm cho `New` không còn quan sát được từ code Kotlin nữa (spawn
    // chuyển Active ngay), nên guard cũ ở job-state.test.ts (dựa vào việc
    // Kotlin đọc được job ở state New) không còn bắt được mutation
    // "isCompleted = !isActive" nữa — đã đo: áp mutation đó vào job.ts rồi
    // chạy TOÀN BỘ 510 test, không cái nào đỏ. Job mới tạo (state New) vẫn là
    // hình dạng DUY NHẤT còn lại phân biệt được hai cái này ở tầng Job, nên
    // guard phải chuyển xuống đây, mức unit test của chính Job.
    const j = new Job('j', 'j', null, false)
    expect(j.isActive).toBe(false)
    expect(j.isCompleted).toBe(false)
  })

  it('isCancelled đúng sau khi Cancelled', () => {
    const j = new Job('j', 'j', null, false)
    j.transitionTo('Active'); j.transitionTo('Cancelling'); j.transitionTo('Cancelled')
    expect(j.isCancelled).toBe(true)
    expect(j.isCompleted).toBe(true)
  })

  it('state không có setter — chỉ đổi được qua transitionTo', () => {
    // Nếu state là field public thì mọi module hạ nguồn đều gán thẳng được
    // và bảng ALLOWED trở thành vô dụng.
    const desc = Object.getOwnPropertyDescriptor(Job.prototype, 'state')
    expect(desc?.get).toBeTypeOf('function')
    expect(desc?.set).toBeUndefined()
  })

  it('addChild ném lỗi khi child.parent không trỏ về job này', () => {
    const p = new Job('p', 'P', null, false)
    const other = new Job('o', 'O', null, false)
    const orphan = new Job('c', 'C', other, false)
    expect(() => p.addChild(orphan)).toThrow(/khớp hai chiều/)
  })

  it('addChild ném lỗi khi child không có parent', () => {
    const p = new Job('p', 'P', null, false)
    const rootless = new Job('c', 'C', null, false)
    expect(() => p.addChild(rootless)).toThrow(/khớp hai chiều/)
  })

  it('liên kết khớp hai chiều thì addChild chạy bình thường', () => {
    const p = new Job('p', 'P', null, false)
    const c = new Job('c', 'C', p, false)
    expect(() => p.addChild(c)).not.toThrow()
    expect(p.children).toEqual([c])
  })

  it('transitionTo về CHÍNH trạng thái hiện tại bị từ chối', () => {
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active')
    expect(() => j.transitionTo('Active')).toThrow(/không hợp lệ/)
  })

  it('New -> Cancelled đi thẳng được (job chưa chạy thì huỷ ngay)', () => {
    const j = new Job('j', 'J', null, false)
    expect(() => j.transitionTo('Cancelled')).not.toThrow()
    expect(j.isCancelled).toBe(true)
  })
})
