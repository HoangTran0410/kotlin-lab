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

  it('finally chạy kể cả khi có exception', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("x") } catch (e: Exception) { println("c") } finally { println("f") }\n}'))
      .toEqual(['c', 'f'])
  })
})
