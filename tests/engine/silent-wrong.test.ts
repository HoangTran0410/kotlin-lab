import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('error() — ném IllegalStateException, không phải no-op', () => {
  it('dừng luồng ngay tại chỗ gọi', () => {
    // Trước khi sửa: in CẢ "before" LẪN "after" — câu error() bị nuốt im lặng.
    const r = runSource(`fun main() = runBlocking {
    println("before")
    error("boom")
    println("after")
}`)
    expect(r.output).toEqual(['before'])
  })

  it('bắt được bằng try/catch và đọc được message', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        error("hỏng rồi")
    } catch (e: IllegalStateException) {
        println("bắt được: " + e.message)
    }
}`)
    expect(r.output).toEqual(['bắt được: hỏng rồi'])
  })

  it('phát EXCEPTION_THROWN đúng kiểu và làm job fail', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { error("từ con") }
}`)
    const ném = r.events.filter(e => e.k === 'EXCEPTION_THROWN')
    expect(ném).toHaveLength(1)
    expect(ném[0]).toMatchObject({ exType: 'IllegalStateException', message: 'từ con' })
    expect(r.events.some(e => e.k === 'FAILURE_PROPAGATED')).toBe(true)
  })

  it('mang đúng số dòng của câu error()', () => {
    const r = runSource(`fun main() = runBlocking {

    error("ở dòng ba")
}`)
    const ném = r.events.find(e => e.k === 'EXCEPTION_THROWN')!
    expect(ném.srcLine).toBe(3)
  })
})

describe('construct chưa hỗ trợ phải BÁO, không được trả giá trị rác', () => {
  const chỗBáo = (src: string) => runSource(src).diagnostics

  it('job.children bị chặn kèm dòng và hint', () => {
    // Trước khi sửa: in ra literal "Job.children" — một object luôn truthy,
    // nên `if (job.children.isEmpty())` sai theo cách không nhìn thấy được.
    const d = chỗBáo(`fun main() = runBlocking {
    val j = launch { delay(10) }
    println(j.children)
}`)
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(3)
    expect(d[0]!.message).toContain('children')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('Thread.currentThread() bị chặn', () => {
    // Trước khi sửa: in ra "kotlin.Unit".
    const d = chỗBáo(`fun main() = runBlocking {
    println(Thread.currentThread().name)
}`)
    expect(d.length).toBeGreaterThan(0)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.hint).toBeTruthy()
  })

  it('không có construct chưa hỗ trợ nào lọt qua mà im lặng trả Unit', async () => {
    // Canh gác theo chiều DƯƠNG: mọi khoá trong danh sách chưa hỗ trợ, khi
    // xuất hiện trong source, đều phải sinh diagnostic. Test này sẽ đỏ nếu ai
    // đó thêm khoá vào danh sách mà validator không quét tới dạng cú pháp đó.
    //
    // Mọi khoá hiện có trong UNSUPPORTED đều là định danh hợp lệ đứng một
    // mình (không phải keyword của lexer, không đòi phải đứng sau dấu chấm),
    // nên `println(<khoá>)` — đọc khoá như một Ident trần — đủ để chạm
    // nhánh 'Ident' của validator cho mọi khoá. Đã xác minh: dạng thử này chạy
    // qua toàn bộ UNSUPPORTED hiện tại (kể cả children/Thread/currentThread
    // vừa thêm) mà không có khoá nào cần cú pháp khác (vd. `x.<khoá>`).
    const { UNSUPPORTED } = await import('../../src/engine/validator/diagnostics')
    for (const khoá of Object.keys(UNSUPPORTED)) {
      const d = chỗBáo(`fun main() = runBlocking {\n    println(${khoá})\n}`)
      expect(d.length, `khoá ${khoá} không sinh diagnostic nào`).toBeGreaterThan(0)
    }
  })
})
