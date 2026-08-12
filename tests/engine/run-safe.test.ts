import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'

const half = [
  '', 'fun main() = runBlocking {', 'fun main() = runBlocking {\n  launch { del',
  'fun main() { println("abc }', '!!!???', 'fun main() = runBlocking { launch { delay(} }',
  'fun main() = runBlocking {\n  /* not closed', 'fun main() { println("${") }', 'val x =',
]

describe('runSourceSafe — never throws', () => {
  it.each(half)('unfinished source %#: returns a diagnostic instead of throwing', src => {
    const r = runSourceSafe(src)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.events).toEqual([])
  })

  it('every diagnostic has a valid 1-based line/col', () => {
    for (const src of half) {
      for (const d of runSourceSafe(src).diagnostics) {
        expect(d.line, `src=${JSON.stringify(src)}`).toBeGreaterThanOrEqual(1)
        expect(d.col, `src=${JSON.stringify(src)}`).toBeGreaterThanOrEqual(1)
        expect(d.message).not.toBe('')
      }
    }
  })

  it('a lexer error carries the CORRECT position, not a hardcoded 1:1', () => {
    // The string opens at line 2 column 14 -> if someone "handled" this by
    // hardcoding 1:1, this test would go red. That's the whole point of it.
    const d = runSourceSafe('fun main() {\n  println("not closed\n}').diagnostics[0]!
    expect(d.line).toBe(2)
    expect(d.col).toBeGreaterThan(1)
  })

  it('a parser error carries the position from ParseError.pos', () => {
    // Uses a case where the offending token is on the SAME LINE as the
    // mistake, so the test asks exactly the question it needs to: does
    // ParseError.pos flow into Diagnostic. Does NOT use '!!!' — three unary
    // operators in a row send parsePrimary looking for an expression and it
    // reports where IT LOOKED ('}' on the next line), not where the user
    // actually typed the mistake. That's existing parser behavior, reasonable, and out of scope for this task.
    const d = runSourceSafe('fun main() {\n\n\n  val = 1\n}').diagnostics[0]!
    expect(d.line).toBe(4)
    expect(d.col).toBeGreaterThan(1)
  })

  it('the parser error position for a missing operand points at where the PARSER LOOKED, not where the typo is', () => {
    // Pinning the current behavior honestly, instead of pretending it's already better.
    // peek() skips NEWLINE, so parsePrimary reports the actual next token.
    // Improving this belongs to a separate task about diagnostic quality
    // (see "Remaining work after M2"), not a sneaky fix here.
    const d = runSourceSafe('fun main() = runBlocking {\n\n\n  !!!\n}').diagnostics[0]!
    expect(d.line).toBe(5)
  })

  it('valid source goes through exactly like runSource — the wrapper does not break the happy path', () => {
    const r = runSourceSafe('fun main() = runBlocking { println("hi") }')
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['hi'])
    expect(r.events.length).toBeGreaterThan(0)
  })

  it('a validator error still keeps its hint', () => {
    const d = runSourceSafe('fun main() = runBlocking { val c = Channel<Int>() }').diagnostics[0]!
    expect(d.hint).toBeDefined()
  })
})
