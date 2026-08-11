import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const printsOf = (src: string) => runSource(src).output

describe('interpreter — lõi', () => {
  it('println với literal', () => {
    expect(printsOf('fun main() {\n  println("hi")\n}')).toEqual(['hi'])
  })

  it('val và string template', () => {
    expect(printsOf('fun main() {\n  val x = 3\n  println("x=$x")\n}')).toEqual(['x=3'])
  })

  it('số học theo đúng độ ưu tiên', () => {
    expect(printsOf('fun main() {\n  println("${1 + 2 * 3}")\n}')).toEqual(['7'])
  })

  it('if/else', () => {
    expect(printsOf('fun main() {\n  if (1 < 2) { println("a") } else { println("b") }\n}')).toEqual(['a'])
  })

  it('for trên khoảng', () => {
    expect(printsOf('fun main() {\n  for (i in 1..3) { println("$i") }\n}')).toEqual(['1', '2', '3'])
  })

  it('repeat(n) chạy đủ n lần', () => {
    // repeat(n) nằm trong subset §4.1 và không có trong danh mục hoãn nào, nhưng
    // chưa được cài: nó rơi xuống nhánh "gọi hàm không biết" và trả Unit im lặng,
    // nên `repeat(3) { println("x") }` không in gì và cũng không báo gì.
    expect(printsOf('fun main() {\n  repeat(3) { println("x") }\n}')).toEqual(['x', 'x', 'x'])
  })

  it('repeat gán chỉ số vào `it`', () => {
    expect(printsOf('fun main() {\n  repeat(3) { println("$it") }\n}')).toEqual(['0', '1', '2'])
  })

  it('repeat nhận tên tham số lambda tự đặt', () => {
    expect(printsOf('fun main() {\n  repeat(2) { i -> println("v$i") }\n}')).toEqual(['v0', 'v1'])
  })

  it('repeat(0) không chạy lần nào', () => {
    expect(printsOf('fun main() {\n  repeat(0) { println("x") }\n}')).toEqual([])
  })

  it('repeat chứa điểm suspend vẫn chạy đúng thứ tự', () => {
    // repeat phải là generator delegation (yield*), không phải vòng lặp thường:
    // nếu nuốt điểm suspend thì delay bên trong nó không nhường quyền được.
    expect(printsOf(
      'fun main() = runBlocking {\n' +
      '  launch { repeat(2) { delay(10); println("B$it") } }\n' +
      '  repeat(2) { delay(10); println("A$it") }\n' +
      '}')).toEqual(['A0', 'B0', 'A1', 'B1'])
  })

  it('while với var', () => {
    expect(printsOf('fun main() {\n  var i = 0\n  while (i < 3) { println("$i")\n    i = i + 1 }\n}'))
      .toEqual(['0', '1', '2'])
  })

  it('gọi hàm do user định nghĩa', () => {
    expect(printsOf('fun greet(n: String) {\n  println("hi $n")\n}\nfun main() {\n  greet("An")\n}'))
      .toEqual(['hi An'])
  })

  it('tham số mặc định', () => {
    expect(printsOf('fun f(n: Int = 5) {\n  println("$n")\n}\nfun main() {\n  f()\n}')).toEqual(['5'])
  })

  it('try/catch bắt được throw', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("boom") } catch (e: Exception) { println("caught") }\n}'))
      .toEqual(['caught'])
  })

  it('return bên trong try KHÔNG bị catch của Kotlin nuốt', () => {
    // ReturnSignal cố ý KHÔNG kế thừa KotlinThrow. Nếu cho nó kế thừa thì
    // 'return 1' bị chính khối catch bắt và hàm trả về 2 — sai lặng lẽ, không
    // exception nào lọt ra. Đã kiểm chứng bằng repro thật, không phải suy đoán.
    expect(printsOf(
      'fun f(): Int {\n' +
      '  try { return 1 } catch (e: Exception) { return 2 }\n' +
      '}\n' +
      'fun main() {\n  println("${f()}")\n}')).toEqual(['1'])
  })

  it('finally vẫn chạy khi thoát bằng return', () => {
    expect(printsOf(
      'fun f(): Int {\n' +
      '  try { return 1 } finally { println("dọn dẹp") }\n' +
      '}\n' +
      'fun main() {\n  println("${f()}")\n}')).toEqual(['dọn dẹp', '1'])
  })

  it('finally chạy kể cả khi có exception', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("x") } catch (e: Exception) { println("c") } finally { println("f") }\n}'))
      .toEqual(['c', 'f'])
  })
})
