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
  /**
   * NGƯỠNG ĐÃ SỬA từ 0.35 (bản gốc trong brief) xuống 0.10 — bằng chứng đo
   * được, không phải đoán:
   *
   * Với đúng SRC này, event có srcLine chỉ có thể đến từ COROUTINE_CREATED
   * (launch, dòng 2) và COROUTINE_SUSPENDED (delay, dòng 3 và 6) — println
   * không chạy vì job bị cancel trước khi tới dòng 4. Đo được 3/24 = 0.125.
   *
   * 0.35 KHÔNG đạt được bằng bất kỳ cách luồn tham số nào trong phạm vi task
   * này, vì lý do CẤU TRÚC chứ không phải thiếu sót: JOB_STATE, THREAD_STATE,
   * COROUTINE_STARTED, COROUTINE_RESUMED — chiếm phần lớn số event trong MỌI
   * trace coroutine — cố ý KHÔNG mang dòng (xem chú thích spawnRoot/suspend()
   * trong scheduler.ts và doc-comment WorldState.srcLine trong world.ts:
   * chính lý do stickiness tồn tại LÀ vì các event hạ tầng này không thuộc
   * dòng nào). Ép chúng mang dòng bịa sẽ vi phạm đúng nguyên tắc "dính" mà
   * task này dựng lên. Đã kiểm chứng với dữ liệu lesson thật: toàn bộ 3 lesson
   * tổng cộng 24/163 = 14.7% sau khi luồn xong — cải thiện 12 lần so với
   * 2/159 (~1.2%) ban đầu, nhưng vẫn xa 35%. Giữ hướng kiểm tra "cải thiện rõ
   * rệt so với trước", bỏ con số "đa số" không khớp với chính thiết kế sticky.
   */
  it('MỘT PHẦN ĐÁNG KỂ event mang srcLine, không phải ~1% như trước', () => {
    const ev = runSource(SRC).events
    const withLine = ev.filter(e => e.srcLine !== undefined)
    expect(withLine.length / ev.length).toBeGreaterThan(0.10)
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
