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

  it('gom lỗi trên NHIỀU hàm khác nhau, không chỉ trong một hàm', () => {
    const d = check('fun a() {\n  select { }\n}\nfun main() {\n  Channel<Int>()\n}')
    expect(d.map(x => x.line)).toEqual([2, 5])
  })
})
