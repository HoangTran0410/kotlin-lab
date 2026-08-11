import { describe, expect, it } from 'vitest'
import { parseProgram } from '../../src/engine/parser/parser'
import { validate } from '../../src/engine/validator/validator'

const check = (src: string) => validate(parseProgram(src))

describe('validator', () => {
  it('code hợp lệ không sinh chẩn đoán', () => {
    expect(check('fun main() = runBlocking {\n  launch { delay(1) }\n}')).toEqual([])
  })

  it('báo construct chưa hỗ trợ kèm đúng số dòng', () => {
    const d = check('fun main() = runBlocking {\n  val c = Channel<Int>()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.message).toContain('Channel')
    expect(d[0]!.message).toContain('chưa được hỗ trợ')
  })

  it('gợi ý cách thay thế cho construct chưa hỗ trợ', () => {
    const d = check('fun main() {\n  select { }\n}')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('báo lỗi khi thiếu fun main', () => {
    const d = check('fun other() {\n}')
    expect(d.some(x => x.message.includes('main'))).toBe(true)
  })

  it('gom nhiều lỗi chứ không dừng ở lỗi đầu', () => {
    const d = check('fun main() {\n  Channel<Int>()\n  select { }\n}')
    expect(d.length).toBeGreaterThanOrEqual(2)
  })

  it('nhận diện toán tử Flow chưa hỗ trợ gọi kiểu thành viên', () => {
    // Đường Member là đường DUY NHẤT bắt được buffer/conflate/debounce/
    // combine/zip — 5/13 mục trong danh mục. Phải test bằng một tên THẬT SỰ
    // có trong UNSUPPORTED, và assert đúng mục đó, không phải mục khác lọt vào.
    const d = check('fun main() {\n  flowOf(1).buffer()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.message).toContain('buffer')
    expect(d[0]!.line).toBe(2)
  })

  it('nhận diện withLock ở dạng gọi thành viên, tách khỏi Mutex', () => {
    const d = check('fun main() {\n  m.withLock { }\n}')
    expect(d.some(x => x.message.includes('withLock'))).toBe(true)
  })

  it('construct HOÃN tới sau M1 được BÁO, không chạy im lặng sai', () => {
    // Hoãn phải nghĩa là ĐƯỢC BÁO. Trước đây mọi lời gọi không nhận ra đều rơi
    // xuống cuối evalCall và trả Unit: `withTimeout(100) { ... }` không chạy gì
    // và cũng không nói gì, `listOf(1).forEach { }` im lặng, `println(j.isActive)`
    // in ra chuỗi "Job.isActive". Sai lặng lẽ tệ hơn hẳn một lỗi khai báo rõ.
    for (const src of [
      'fun main() = runBlocking {\n  withTimeout(100) { delay(1) }\n}',
      'fun main() = runBlocking {\n  listOf(1).forEach { }\n}',
      'fun main() = runBlocking {\n  println(j.isActive)\n}',
      'fun main() = runBlocking {\n  ensureActive()\n}',
      'fun main() = runBlocking {\n  NonCancellable\n}',
    ]) {
      const d = check(src)
      expect(d.length, src).toBeGreaterThanOrEqual(1)
      expect(d[0]!.hint, src).toBeTruthy()
      expect(d[0]!.line, src).toBe(2)
    }
  })

  it('repeat KHÔNG bị báo — nó nằm trong subset và đã cài', () => {
    expect(check('fun main() {\n  repeat(3) { println("x") }\n}')).toEqual([])
  })

  it('GlobalScope / cancelAndJoin KHÔNG bị báo — đã cài', () => {
    expect(check(
      'fun main() = runBlocking {\n' +
      '  val j = GlobalScope.launch { delay(1) }\n' +
      '  j.cancelAndJoin()\n' +
      '}')).toEqual([])
  })

  it('gom lỗi trên NHIỀU hàm khác nhau, không chỉ trong một hàm', () => {
    const d = check('fun a() {\n  select { }\n}\nfun main() {\n  Channel<Int>()\n}')
    expect(d.map(x => x.line)).toEqual([2, 5])
  })
})
