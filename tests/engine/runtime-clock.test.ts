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
    // Test này chốt HỢP ĐỒNG mà scheduler dựa vào, không chốt cơ chế.
    // Ghi chú trung thực: tiêu chí phụ `a.seq - b.seq` trong comparator là
    // THỪA về mặt chức năng — Array.sort ổn định từ ES2019 nên thứ tự chèn
    // vốn đã được giữ. Đã kiểm chứng bằng thực nghiệm: bỏ tiêu chí đó đi
    // test vẫn xanh. Giữ lại vì nó nói rõ ý đồ và vẫn đúng nếu sau này đổi
    // sang cấu trúc khác (heap chẳng hạn) vốn không ổn định.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    c.schedule(50, () => fired.push('sớm'))
    c.schedule(100, () => fired.push('b'))
    c.schedule(100, () => fired.push('c'))
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['sớm', 'a', 'b', 'c'])
  })

  it('timer đặt CÙNG MỐC trong lúc callback chạy vẫn nổ, không rơi mất', () => {
    // delay(0) lồng nhau sinh ra đúng tình huống này. Phải dùng CÙNG mốc:
    // nếu đặt ở mốc khác thì vòng lặp advanceToNextTimer sẽ nhặt được ở lượt
    // sau bất kể cài đặt thế nào, và test mất khả năng phân biệt.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => {
      fired.push('ngoài')
      c.schedule(100, () => fired.push('trong'))
    })
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['ngoài', 'trong'])
    expect(c.now).toBe(100)
  })

  it('timer tự đặt lại chính nó không làm treo vòng lặp vô hạn', () => {
    const c = new VirtualClock()
    let n = 0
    const tick = () => { if (++n < 3) c.schedule(c.now, tick) }
    c.schedule(10, tick)
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(n).toBe(3)
    expect(c.now).toBe(10)
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
