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
    const d = runSourceSafe('fun main() = runBlocking {\n\n\n  !!!\n}').diagnostics[0]!
    expect(d.line).toBe(4)
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
