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

  it('join() chờ job bị huỷ UNWIND XONG mới trả về', () => {
    // Ngược hẳn với test bất-đồng-bộ ở dưới: ở đó không ai chờ, ở đây có join().
    // Bug: cancelJob lật thẳng Active->Cancelling->Cancelled trong MỘT lời gọi,
    // nên không job nào bao giờ NGHỈ ở Cancelling; sweepWaiters chỉ nhìn state
    // và đánh thức người chờ ngay lập tức, TRƯỚC khi finally của job bị huỷ kịp
    // chạy. Kotlin cho ["cleanup", "done"], engine cho ["done", "cleanup"].
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("cleanup") } }\n' +
      '  delay(50)\n' +
      '  j.cancel()\n' +
      '  j.join()\n' +
      '  println("done")\n' +
      '}')).toEqual(['cleanup', 'done'])
  })

  it('cancelAndJoin() huỷ RỒI CHỜ — không phải bí danh của cancel()', () => {
    // cancelAndJoin từng được nối thẳng vào nhánh cancel và im lặng KHÔNG join,
    // nên nó cho ra đúng thứ tự sai mà người học dùng nó để tránh.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("cleanup") } }\n' +
      '  delay(50)\n' +
      '  j.cancelAndJoin()\n' +
      '  println("done")\n' +
      '}')).toEqual(['cleanup', 'done'])
  })

  it('catch quanh coroutineScope chạy SAU finally của anh em bị huỷ', () => {
    // Kotlin: coroutineScope không ném lại cho tới khi MỌI con đã unwind xong,
    // nên ["cleanup A", "caught boom"]. Engine cho ngược lại: failure của con
    // leo lên đánh dấu chính job runBlocking là Cancelled, và unwindCancelled
    // duyệt taskOrder — tức thứ tự TẠO, nông trước — nên tổ tiên được ném vào
    // (chạy catch) trước khi con cháu kịp chạy finally.
    expect(out(
      'fun main() = runBlocking {\n' +
      '    try {\n' +
      '        coroutineScope {\n' +
      '            launch { try { delay(1000) } finally { println("cleanup A") } }\n' +
      '            launch { delay(10); throw RuntimeException("boom") }\n' +
      '        }\n' +
      '    } catch (e: Exception) { println("caught " + e.message) }\n' +
      '}')).toEqual(['cleanup A', 'caught boom'])
  })

  it('THÂN coroutineScope ném: cũng phải chờ con unwind xong mới ném ra ngoài', () => {
    // Đường thứ hai của cùng một luật. Ở trên exception đến TỪ con nên đi qua
    // reportFailure; ở đây chính thân scope ném nên đi qua failInline. Nếu chỉ
    // sửa đường trên thì đường này vẫn cho ["caught boom", "cleanup A"].
    expect(out(
      'fun main() = runBlocking {\n' +
      '  try {\n' +
      '    coroutineScope {\n' +
      '      launch { try { delay(1000) } finally { println("cleanup A") } }\n' +
      '      delay(10)\n' +
      '      throw RuntimeException("boom")\n' +
      '    }\n' +
      '  } catch (e: Exception) { println("caught " + e.message) }\n' +
      '}')).toEqual(['cleanup A', 'caught boom'])
  })

  it('root FAIL vẫn để con chạy nốt finally trước khi chương trình dừng', () => {
    // Bẫy của việc dừng vòng lặp khi root kết thúc (chốt "JVM thoát"): khi root
    // FAIL, task của nó được đánh finished ngay trong step() trong khi con vừa
    // bị huỷ còn chưa unwind. Chốt đặt sớm hơn unwindCancelled sẽ nuốt mất
    // `finally` của con — Kotlin thì runBlocking chờ con unwind xong mới ném ra.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  launch { try { delay(1000) } finally { println("cleanup") } }\n' +
      '  delay(10)\n' +
      '  throw RuntimeException("x")\n' +
      '}')).toEqual(['cleanup'])
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
