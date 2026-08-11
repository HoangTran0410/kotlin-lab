import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'

const half = [
  '', 'fun main() = runBlocking {', 'fun main() = runBlocking {\n  launch { del',
  'fun main() { println("abc }', '!!!???', 'fun main() = runBlocking { launch { delay(} }',
  'fun main() = runBlocking {\n  /* chưa đóng', 'fun main() { println("${") }', 'val x =',
]

describe('runSourceSafe — không bao giờ ném', () => {
  it.each(half)('source dở dang %#: trả diagnostic thay vì ném', src => {
    const r = runSourceSafe(src)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.events).toEqual([])
  })

  it('mọi diagnostic có line/col 1-based hợp lệ', () => {
    for (const src of half) {
      for (const d of runSourceSafe(src).diagnostics) {
        expect(d.line, `src=${JSON.stringify(src)}`).toBeGreaterThanOrEqual(1)
        expect(d.col, `src=${JSON.stringify(src)}`).toBeGreaterThanOrEqual(1)
        expect(d.message).not.toBe('')
      }
    }
  })

  it('lỗi lexer mang ĐÚNG vị trí, không phải mặc định 1:1', () => {
    // chuỗi mở ở dòng 2 cột 14 -> nếu ai đó "xử lý" bằng cách trả cứng 1:1
    // thì test này đỏ. Đó là điểm của nó.
    const d = runSourceSafe('fun main() {\n  println("chưa đóng\n}').diagnostics[0]!
    expect(d.line).toBe(2)
    expect(d.col).toBeGreaterThan(1)
  })

  it('lỗi parser mang vị trí từ ParseError.pos', () => {
    // Dùng ca mà token gây lỗi nằm CÙNG DÒNG với chỗ sai, để test hỏi đúng
    // thứ nó cần hỏi: ParseError.pos có chảy vào Diagnostic không.
    // KHÔNG dùng '!!!' — ba toán tử một ngôi khiến parsePrimary đi tìm biểu
    // thức và báo chỗ NÓ TÌM ('}' ở dòng sau), không phải chỗ user gõ sai.
    // Đó là hành vi có sẵn của parser, hợp lý, và không thuộc phạm vi task này.
    const d = runSourceSafe('fun main() {\n\n\n  val = 1\n}').diagnostics[0]!
    expect(d.line).toBe(4)
    expect(d.col).toBeGreaterThan(1)
  })

  it('vị trí lỗi parser khi thiếu toán hạng trỏ vào chỗ PARSER TÌM, không phải chỗ gõ sai', () => {
    // Ghim hành vi hiện tại cho trung thực, thay vì giả vờ nó đã tốt hơn.
    // peek() bỏ qua NEWLINE nên parsePrimary báo token thật kế tiếp.
    // Cải thiện chỗ này là việc của một task riêng về chất lượng diagnostic
    // (xem "Việc còn lại sau M2"), không phải sửa lén ở đây.
    const d = runSourceSafe('fun main() = runBlocking {\n\n\n  !!!\n}').diagnostics[0]!
    expect(d.line).toBe(5)
  })

  it('source hợp lệ đi qua y hệt runSource — không bọc làm hỏng đường thuận', () => {
    const r = runSourceSafe('fun main() = runBlocking { println("hi") }')
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['hi'])
    expect(r.events.length).toBeGreaterThan(0)
  })

  it('lỗi validator vẫn giữ nguyên hint', () => {
    const d = runSourceSafe('fun main() = runBlocking { val c = Channel<Int>() }').diagnostics[0]!
    expect(d.hint).toBeDefined()
  })
})
