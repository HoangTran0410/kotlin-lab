import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string): string[] => runSource(src).output
const diags = (src: string): unknown[] => runSource(src).diagnostics

describe('when with a subject — compares the subject against each branch value', () => {
  it('picks the branch matching the value, not the first branch', () => {
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

  it('runs else when no branch matches', () => {
    // This is the case that CAUGHT the original bug: before the fix, x=99 still printed "one".
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

  it('can compare strings too', () => {
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

  it('with no else and no branch matching, prints nothing and does not blow up', () => {
    const src = `fun main() = runBlocking {
    val x = 7
    when (x) {
        1 -> println("one")
    }
    println("survived")
}`
    expect(out(src)).toEqual(['survived'])
  })
})

describe('when with no subject — each branch is a boolean condition', () => {
  it('keeps the old semantics: picks the first true condition', () => {
    const src = `fun main() = runBlocking {
    val n = 5
    when {
        n > 10 -> println("big")
        n > 3 -> println("medium")
        else -> println("small")
    }
}`
    expect(out(src)).toEqual(['medium'])
  })
})

describe('when — the right-hand side is an expression, braces are not required', () => {
  it('an expression-form branch parses cleanly and runs correctly', () => {
    // Before the fix: "Expected LBRACE but found 'println'".
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

  it('mixing a block branch and an expression branch in the same when', () => {
    const src = `fun main() = runBlocking {
    val x = 1
    when (x) {
        1 -> { println("one"); println("still one") }
        2 -> println("two")
        else -> println("other")
    }
}`
    expect(out(src)).toEqual(['one', 'still one'])
  })

  it('when used as an expression can be assigned to a val', () => {
    // Identifier deliberately ASCII: the lexer currently only accepts
    // [A-Za-z0-9_] — Unicode in identifiers (e.g. accented names) is an
    // EXISTING limitation of the lexer, unrelated to the two when-bugs being
    // patched here — see task-1-report.md.
    const src = `fun main() = runBlocking {
    val x = 2
    val name = when (x) {
        1 -> "one"
        2 -> "two"
        else -> "other"
    }
    println(name)
}`
    expect(out(src)).toEqual(['two'])
  })

  it('an expression branch containing a suspend point still suspends correctly', () => {
    // The right-hand side runs via yield*, not a plain call — if implemented
    // wrong, a delay inside the branch wouldn't yield control and the virtual clock wouldn't advance.
    const src = `fun main() = runBlocking {
    val x = 1
    when (x) {
        1 -> delay(100)
        else -> println("not reached")
    }
    println("after when")
}`
    const r = runSource(src)
    expect(r.output).toEqual(['after when'])
    const last = r.events[r.events.length - 1]!
    expect(last.t).toBeGreaterThanOrEqual(100)
  })
})
