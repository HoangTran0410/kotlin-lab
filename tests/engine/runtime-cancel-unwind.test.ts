import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string) => runSource(src).output

describe('cancel làm unwind thân coroutine', () => {
  // GHI CHÚ QUAN TRỌNG: `launch` KHÔNG chạy đồng bộ, đúng như Kotlin thật.
  // `launch { }` rồi `j.cancel()` ngay là huỷ TRƯỚC khi coroutine kịp bắt
  // đầu — Kotlin thật cũng không in gì cả, vì không có gì để unwind.
  // Muốn kiểm unwind thì phải `yield()` cho nó chạy tới điểm suspend đã.

  it('cancel TRƯỚC khi coroutine kịp chạy thì không có finally nào — giống Kotlin thật', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("khong-chay") } }\n' +
      '  j.cancel()\n' +
      '}')).toEqual([])
  })

  it('finally chạy khi cancel lúc coroutine ĐANG suspend', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000); println("xong") } finally { println("dọn dẹp") } }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '}')).toEqual(['dọn dẹp'])
  })

  it('phần thân sau điểm suspend KHÔNG chạy khi bị cancel', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(1000); println("khong-duoc-in") }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '}')).toEqual([])
  })

  it('finally lồng nhau chạy từ trong ra ngoài', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch {\n' +
      '    try {\n' +
      '      try { delay(1000) } finally { println("trong") }\n' +
      '    } finally { println("ngoài") }\n' +
      '  }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '}')).toEqual(['trong', 'ngoài'])
  })

  it('cancel cha làm finally của con chạy', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val p = launch {\n' +
      '    launch { try { delay(1000) } finally { println("con dọn dẹp") } }\n' +
      '    delay(1000)\n' +
      '  }\n' +
      '  delay(1)\n' +
      '  p.cancel()\n' +
      '}')).toEqual(['con dọn dẹp'])
  })

  it('cancel() là BẤT ĐỒNG BỘ — lệnh sau nó chạy trước finally', () => {
    // Đây là bẫy thật của Kotlin, đáng dạy. `cancel()` chỉ YÊU CẦU huỷ rồi
    // trả về ngay; `println("sau cancel")` chạy tức thì, còn finally của
    // coroutine bị huỷ chỉ chạy khi nó được resume để unwind.
    // Muốn thứ tự ngược lại phải dùng cancelAndJoin() — chưa hỗ trợ ở M1.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("xong dọn") } }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '  println("sau cancel")\n' +
      '}')).toEqual(['sau cancel', 'xong dọn'])
  })
})
