import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../src/engine/runtime/clock'

describe('VirtualClock', () => {
  it('bắt đầu ở 0', () => {
    expect(new VirtualClock().now).toBe(0)
  })

  it('advance nhảy tới timer gần nhất và chạy callback', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    expect(c.advanceToNextTimer()).toBe(true)
    expect({ now: c.now, fired }).toEqual({ now: 100, fired: ['a'] })
  })

  it('chạy timer theo thứ tự thời gian tăng dần', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(300, () => fired.push('c'))
    c.schedule(100, () => fired.push('a'))
    c.schedule(200, () => fired.push('b'))
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['a', 'b', 'c'])
  })

  it('timer cùng thời điểm chạy theo thứ tự đăng ký — bảo đảm deterministic', () => {
    // Dùng nhiều timer và ĐĂNG KÝ XEN KẼ với mốc khác, để test không thể xanh
    // nhờ may. Với chỉ 2 phần tử cùng mốc, Array.sort ổn định (ES2019+) sẽ giữ
    // đúng thứ tự kể cả khi thiếu tiêu chí seq — test sẽ mù đúng thứ nó canh.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    c.schedule(50, () => fired.push('sớm'))
    c.schedule(100, () => fired.push('b'))
    c.schedule(100, () => fired.push('c'))
    c.schedule(100, () => fired.push('d'))
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['sớm', 'a', 'b', 'c', 'd'])
  })

  it('timer đặt trong lúc callback chạy không bị mất', () => {
    // delay() lồng nhau sinh ra tình huống này: callback của timer lại đặt
    // tiếp một timer. Nếu advanceToNextTimer chụp danh sách trước khi chạy
    // callback thì timer mới sẽ rơi mất.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => {
      fired.push('ngoài')
      c.schedule(200, () => fired.push('trong'))
    })
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['ngoài', 'trong'])
    expect(c.now).toBe(200)
  })

  it('cancel gỡ timer chưa chạy', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    const id = c.schedule(100, () => fired.push('a'))
    c.cancel(id)
    expect(c.advanceToNextTimer()).toBe(false)
    expect(fired).toEqual([])
  })

  it('advance trả false khi hết timer', () => {
    expect(new VirtualClock().advanceToNextTimer()).toBe(false)
  })

  it('thời gian không bao giờ lùi', () => {
    const c = new VirtualClock()
    c.schedule(100, () => {})
    c.advanceToNextTimer()
    c.schedule(50, () => {})
    c.advanceToNextTimer()
    expect(c.now).toBe(100)
  })
})
