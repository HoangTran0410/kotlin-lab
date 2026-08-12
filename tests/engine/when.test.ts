import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string): string[] => runSource(src).output
const diags = (src: string): unknown[] => runSource(src).diagnostics

describe('when có subject — so sánh subject với giá trị nhánh', () => {
  it('chọn nhánh khớp giá trị, không phải nhánh đầu tiên', () => {
    const src = `fun main() = runBlocking {
    val x = 2
    when (x) {
        1 -> println("one")
        2 -> println("two")
        else -> println("other")
    }
}`
    expect(diags(src)).toEqual([])
    expect(out(src)).toEqual(['two'])
  })

  it('không nhánh nào khớp thì chạy else', () => {
    // Ca này là ca PHÁT HIỆN bug gốc: trước khi sửa, x=99 vẫn in "one".
    const src = `fun main() = runBlocking {
    val x = 99
    when (x) {
        1 -> println("one")
        2 -> println("two")
        else -> println("other")
    }
}`
    expect(out(src)).toEqual(['other'])
  })

  it('so sánh được cả chuỗi', () => {
    const src = `fun main() = runBlocking {
    val s = "b"
    when (s) {
        "a" -> println("A")
        "b" -> println("B")
        else -> println("Z")
    }
}`
    expect(out(src)).toEqual(['B'])
  })

  it('không có else và không nhánh nào khớp thì không in gì, không nổ', () => {
    const src = `fun main() = runBlocking {
    val x = 7
    when (x) {
        1 -> println("one")
    }
    println("sống sót")
}`
    expect(out(src)).toEqual(['sống sót'])
  })
})

describe('when không subject — mỗi nhánh là một điều kiện boolean', () => {
  it('giữ nguyên ngữ nghĩa cũ: chọn điều kiện đúng đầu tiên', () => {
    const src = `fun main() = runBlocking {
    val n = 5
    when {
        n > 10 -> println("lớn")
        n > 3 -> println("vừa")
        else -> println("nhỏ")
    }
}`
    expect(out(src)).toEqual(['vừa'])
  })
})

describe('when — vế phải là biểu thức, không bắt buộc ngoặc nhọn', () => {
  it('nhánh dạng biểu thức parse sạch và chạy đúng', () => {
    // Trước khi sửa: "Mong đợi LBRACE nhưng gặp 'println'".
    const src = `fun main() = runBlocking {
    val x = 2
    when (x) {
        1 -> println("one")
        2 -> println("two")
    }
}`
    expect(diags(src)).toEqual([])
    expect(out(src)).toEqual(['two'])
  })

  it('trộn nhánh block và nhánh biểu thức trong cùng một when', () => {
    const src = `fun main() = runBlocking {
    val x = 1
    when (x) {
        1 -> { println("một"); println("vẫn một") }
        2 -> println("hai")
        else -> println("khác")
    }
}`
    expect(out(src)).toEqual(['một', 'vẫn một'])
  })

  it('when dùng làm biểu thức gán được vào val', () => {
    // Định danh 'ten' viết không dấu: lexer hiện tại chỉ nhận [A-Za-z0-9_],
    // Unicode trong định danh (vd. 'tên') là giới hạn CÓ SẴN của lexer, không
    // liên quan tới hai lỗi when đang vá — xem task-1-report.md.
    const src = `fun main() = runBlocking {
    val x = 2
    val ten = when (x) {
        1 -> "một"
        2 -> "hai"
        else -> "khác"
    }
    println(ten)
}`
    expect(out(src)).toEqual(['hai'])
  })

  it('nhánh biểu thức có điểm suspend vẫn suspend đúng', () => {
    // Vế phải chạy bằng yield* chứ không phải gọi thường — nếu cài sai,
    // delay bên trong nhánh sẽ không nhường quyền và đồng hồ ảo không nhích.
    const src = `fun main() = runBlocking {
    val x = 1
    when (x) {
        1 -> delay(100)
        else -> println("không tới")
    }
    println("sau when")
}`
    const r = runSource(src)
    expect(r.output).toEqual(['sau when'])
    const cuối = r.events[r.events.length - 1]!
    expect(cuối.t).toBeGreaterThanOrEqual(100)
  })
})
