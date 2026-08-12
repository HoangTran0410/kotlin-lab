import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const printsOf = (src: string) => runSource(src).output

describe('interpreter — core', () => {
  it('println with a literal', () => {
    expect(printsOf('fun main() {\n  println("hi")\n}')).toEqual(['hi'])
  })

  it('val and a string template', () => {
    expect(printsOf('fun main() {\n  val x = 3\n  println("x=$x")\n}')).toEqual(['x=3'])
  })

  it('arithmetic follows the correct precedence', () => {
    expect(printsOf('fun main() {\n  println("${1 + 2 * 3}")\n}')).toEqual(['7'])
  })

  it('if/else', () => {
    expect(printsOf('fun main() {\n  if (1 < 2) { println("a") } else { println("b") }\n}')).toEqual(['a'])
  })

  it('for over a range', () => {
    expect(printsOf('fun main() {\n  for (i in 1..3) { println("$i") }\n}')).toEqual(['1', '2', '3'])
  })

  it('repeat(n) runs exactly n times', () => {
    // repeat(n) is part of subset §4.1 and is not on any deferred list, but
    // wasn't implemented yet: it fell into the "unknown function call" branch
    // and returned Unit silently, so `repeat(3) { println("x") }` printed
    // nothing and reported nothing.
    expect(printsOf('fun main() {\n  repeat(3) { println("x") }\n}')).toEqual(['x', 'x', 'x'])
  })

  it('repeat assigns the index into `it`', () => {
    expect(printsOf('fun main() {\n  repeat(3) { println("$it") }\n}')).toEqual(['0', '1', '2'])
  })

  it('repeat accepts a custom lambda parameter name', () => {
    expect(printsOf('fun main() {\n  repeat(2) { i -> println("v$i") }\n}')).toEqual(['v0', 'v1'])
  })

  it('repeat(0) runs zero times', () => {
    expect(printsOf('fun main() {\n  repeat(0) { println("x") }\n}')).toEqual([])
  })

  it('repeat containing a suspend point still runs in the right order', () => {
    // repeat must be generator delegation (yield*), not a plain loop: if it
    // swallowed the suspend point, a delay inside it couldn't yield control.
    expect(printsOf(
      'fun main() = runBlocking {\n' +
      '  launch { repeat(2) { delay(10); println("B$it") } }\n' +
      '  repeat(2) { delay(10); println("A$it") }\n' +
      '}')).toEqual(['A0', 'B0', 'A1', 'B1'])
  })

  it('while with a var', () => {
    expect(printsOf('fun main() {\n  var i = 0\n  while (i < 3) { println("$i")\n    i = i + 1 }\n}'))
      .toEqual(['0', '1', '2'])
  })

  it('calling a user-defined function', () => {
    expect(printsOf('fun greet(n: String) {\n  println("hi $n")\n}\nfun main() {\n  greet("An")\n}'))
      .toEqual(['hi An'])
  })

  it('a default parameter', () => {
    expect(printsOf('fun f(n: Int = 5) {\n  println("$n")\n}\nfun main() {\n  f()\n}')).toEqual(['5'])
  })

  it('try/catch catches a throw', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("boom") } catch (e: Exception) { println("caught") }\n}'))
      .toEqual(['caught'])
  })

  it('return inside try is NOT swallowed by Kotlin\'s catch', () => {
    // ReturnSignal deliberately does NOT extend KotlinThrow. If it did,
    // 'return 1' would get caught by the catch block itself and the function
    // would return 2 — silently wrong, with no exception ever escaping.
    // Verified with an actual repro, not just reasoned about.
    expect(printsOf(
      'fun f(): Int {\n' +
      '  try { return 1 } catch (e: Exception) { return 2 }\n' +
      '}\n' +
      'fun main() {\n  println("${f()}")\n}')).toEqual(['1'])
  })

  it('finally still runs when exiting via return', () => {
    expect(printsOf(
      'fun f(): Int {\n' +
      '  try { return 1 } finally { println("cleanup") }\n' +
      '}\n' +
      'fun main() {\n  println("${f()}")\n}')).toEqual(['cleanup', '1'])
  })

  it('finally runs even when there is an exception', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("x") } catch (e: Exception) { println("c") } finally { println("f") }\n}'))
      .toEqual(['c', 'f'])
  })
})
