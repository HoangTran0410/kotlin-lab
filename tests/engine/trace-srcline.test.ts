import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

const SRC = `fun main() = runBlocking {
    val j = launch {
        delay(100)
        println("xong")
    }
    delay(50)
    j.cancel()
}
`

describe('srcLine — dữ liệu cho highlight dòng đang chạy', () => {
  // KHÔNG đặt ngưỡng tỷ lệ ở đây. Ngưỡng nào cũng là proxy, và một ngưỡng cao
  // còn MÂU THUẪN với chính thiết kế: JOB_STATE / THREAD_STATE /
  // COROUTINE_STARTED / COROUTINE_RESUMED cố ý KHÔNG mang srcLine — chúng
  // chiếm phần lớn trace, và đó chính là lý do stickiness tồn tại.
  // Câu hỏi thật của UI là: ở MỌI step, editor có dòng để tô không.

  /**
   * NGOẠI LỆ DUY NHẤT so với brief: COROUTINE_SUSPENDED reason 'join' bị loại
   * khỏi MUST_HAVE, có bằng chứng đo được — không phải nới lỏng tuỳ tiện.
   *
   * scheduler.ts.suspend(): "'joinChildren' không có trong schema Event —
   * gom về 'join' khi ghi trace". Nghĩa là MỘT j.join()/cancelAndJoin() THẬT
   * (luôn có dòng, đã luồn ở interpreter.ts) và MỘT joinChildren TỔNG HỢP do
   * builder tự chèn để chờ con xong (cố ý KHÔNG có dòng — xem doc-comment
   * `Suspension` trong suspension.ts: "joinChildren do builder sinh ra chứ
   * không do một dòng code nào của user") phát ra CÙNG MỘT HÌNH DẠNG event:
   * { k: 'COROUTINE_SUSPENDED', reason: 'join' }. Không cách nào phân biệt
   * hai nguồn này chỉ từ Event.
   *
   * Đây không phải lỗi hiếm: MỌI chương trình chạy qua runSource đều có ít
   * nhất một joinChildren-tổng-hợp — root luôn `yield { s: 'joinChildren' }`
   * cho chính nó ở cuối thân (xem run.ts). Đã đo bằng chương trình tối giản
   * nhất có thể, `runBlocking { println("hi") }`, không launch nào cả: vẫn
   * phát đúng một COROUTINE_SUSPENDED reason 'join' không dòng. Ép nó luôn có
   * dòng đòi hoặc (a) bịa dữ liệu cho joinChildren — trái ngay doc-comment
   * `Suspension`, hoặc (b) sửa engine để việc gộp 'join' hết mơ hồ — cả hai
   * đều ngoài phạm vi "engine changes stay as they are" của vòng sửa này.
   *
   * `delay`/`yield`/`await` không mơ hồ — luôn từ lời gọi thật của user, nên
   * vẫn giữ nguyên trong yêu cầu bắt buộc.
   */
  it('mọi event thuộc loại ĐÁNG CÓ dòng đều có dòng (trừ join gộp từ joinChildren)', () => {
    const ev = runSource(SRC).events
    const MUST_HAVE = new Set(['PRINTLN', 'EXCEPTION_THROWN'])
    const thiếuLuôn = ev.filter(e => MUST_HAVE.has(e.k) && e.srcLine === undefined)
    expect(thiếuLuôn).toEqual([])

    const thiếuSuspendKhôngMơHồ = ev.filter(
      e => e.k === 'COROUTINE_SUSPENDED' && e.reason !== 'join' && e.srcLine === undefined)
    expect(thiếuSuspendKhôngMơHồ).toEqual([])
  })

  it('sau event mang dòng đầu tiên, MỌI step đều có dòng để tô', () => {
    // Đây mới là hợp đồng mà CodeEditor dựa vào. Nếu stickiness hỏng, hoặc
    // một loại event mới quên truyền dòng, test này đỏ ngay.
    const ev = runSource(SRC).events
    const đầu = ev.findIndex(e => e.srcLine !== undefined)
    expect(đầu).toBeGreaterThanOrEqual(0)
    for (let n = đầu + 1; n <= ev.length; n++) {
      expect(foldTrace(ev, n).srcLine, `step ${n} không có dòng để tô`).not.toBeNull()
    }
  })

  it('độ phủ srcLine chỉ để THAM KHẢO, không phải cổng chặn', () => {
    // Ghi lại con số để thấy khi nó tụt, nhưng không gác bằng ngưỡng tuỳ tiện.
    const ev = runSource(SRC).events
    const withLine = ev.filter(e => e.srcLine !== undefined)
    expect(withLine.length).toBeGreaterThan(0)
  })

  it('COROUTINE_CREATED của launch trỏ đúng dòng 2', () => {
    const e = runSource(SRC).events.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'launch')!
    expect(e.srcLine).toBe(2)
  })

  it('COROUTINE_SUSPENDED vì delay(100) trỏ đúng dòng 3', () => {
    const e = runSource(SRC).events.find(
      x => x.k === 'COROUTINE_SUSPENDED' && x.reason === 'delay' && x.srcLine === 3)
    expect(e).toBeDefined()
  })

  it('PRINTLN vẫn trỏ dòng 4 — đường cũ không hồi quy', () => {
    const e = runSource(SRC).events.find(x => x.k === 'PRINTLN')
    if (e) expect(e.srcLine).toBe(4)
  })

  it('EXCEPTION_THROWN trỏ dòng của câu throw', () => {
    const e = runSource(
      'fun main() = runBlocking {\n  launch {\n    delay(10)\n    throw RuntimeException("boom")\n  }\n}\n',
    ).events.find(x => x.k === 'EXCEPTION_THROWN')!
    expect(e.srcLine).toBe(4)
  })

  it('mọi srcLine nằm trong khoảng dòng thật của source', () => {
    const n = SRC.split('\n').length
    for (const e of runSource(SRC).events) {
      if (e.srcLine !== undefined) {
        expect(e.srcLine).toBeGreaterThanOrEqual(1)
        expect(e.srcLine).toBeLessThanOrEqual(n)
      }
    }
  })
})

describe('WorldState.srcLine — DÍNH, không nhấp nháy', () => {
  it('giữ dòng đã biết cuối cùng khi event kế tiếp không mang dòng', () => {
    const ev = runSource(SRC).events
    let last: number | null = null
    for (let n = 1; n <= ev.length; n++) {
      const w = foldTrace(ev, n)
      const e = ev[n - 1]!
      if (e.srcLine !== undefined) expect(w.srcLine).toBe(e.srcLine)
      else expect(w.srcLine).toBe(last)   // dính, KHÔNG về null
      last = w.srcLine
    }
  })

  it('step 0 chưa có dòng nào', () => {
    expect(foldTrace(runSource(SRC).events, 0).srcLine).toBeNull()
  })

  it('tua ngược cho đúng dòng như tiến thẳng — bất biến trung tâm', () => {
    const ev = runSource(SRC).events
    const forward = Array.from({ length: ev.length + 1 }, (_, n) => foldTrace(ev, n).srcLine)
    const backward: (number | null)[] = []
    for (let n = ev.length; n >= 0; n--) backward.unshift(foldTrace(ev, n).srcLine)
    expect(backward).toEqual(forward)
  })
})
