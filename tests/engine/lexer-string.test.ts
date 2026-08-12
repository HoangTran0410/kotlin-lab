import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — strings and comments', () => {
  it('a plain string becomes a single text part', () => {
    const t = tokenize('"hello"')[0]!
    expect(t.kind).toBe('STRING')
    expect(t.parts).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('a $ident template splits into an expr part', () => {
    // "a $x b" -> col 1='"' 2='a' 3=' ' 4='$' 5='x'. The expr part must point at
    // the START position of the expression (column 5), same as ${...} does.
    const t = tokenize('"a $x b"')[0]!
    expect(t.parts).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'expr', source: 'x', line: 1, col: 5 },
      { type: 'text', value: ' b' },
    ])
  })

  it('a multi-character $ident still points at its first character', () => {
    const t = tokenize('"$name"')[0]!
    expect(t.parts).toEqual([{ type: 'expr', source: 'name', line: 1, col: 3 }])
  })

  it('a ${expr} template keeps the inner expression intact', () => {
    const t = tokenize('"n=${a.b(1)}"')[0]!
    expect(t.parts?.[1]).toEqual({ type: 'expr', source: 'a.b(1)', line: 1, col: 6 })
  })

  it('escape sequences are decoded', () => {
    const t = tokenize('"a\\nb\\$c"')[0]!
    expect(t.parts).toEqual([{ type: 'text', value: 'a\nb$c' }])
  })

  it('skips line comments and block comments', () => {
    const toks = tokenize('val a // a note\n/* several\nlines */ val b')
    expect(toks.filter(t => t.kind === 'IDENT').map(t => t.text)).toEqual(['a', 'b'])
  })

  it('content inside a comment produces no tokens at all', () => {
    // This test actually checks comment skipping: if the comment weren't
    // handled, the 'val' and 'b' inside it would leak out as tokens.
    const toks = tokenize('/* val b = 1 */ val a')
    expect(toks.filter(t => t.kind === 'IDENT' || t.kind === 'KEYWORD').map(t => t.text))
      .toEqual(['val', 'a'])
  })

  it('a multi-line block comment still counts lines correctly', () => {
    const toks = tokenize('/* a\nb */\nval x')
    expect(toks.find(t => t.text === 'x')!.line).toBe(3)
  })

  it('a lambda nested inside ${} does not end the part early', () => {
    const t = tokenize('"${list.map { it }}"')[0]!
    expect(t.parts).toEqual([{ type: 'expr', source: 'list.map { it }', line: 1, col: 4 }])
  })

  it('a lone $ is a plain character, not a template', () => {
    expect(tokenize('"costs 5$ only"')[0]!.parts).toEqual([{ type: 'text', value: 'costs 5$ only' }])
  })

  it('$ followed by a digit is not a template', () => {
    expect(tokenize('"$5"')[0]!.parts).toEqual([{ type: 'text', value: '$5' }])
  })

  it('an unterminated string throws with its opening position', () => {
    expect(() => tokenize('val s = "abc')).toThrow(/unterminated string.*line 1.*column 9/)
  })

  it('an unterminated block comment throws', () => {
    expect(() => tokenize('val a\n/* not closed')).toThrow(/unterminated block comment.*line 2/)
  })

  it('an unclosed ${ throws', () => {
    expect(() => tokenize('"n=${a"')).toThrow(/missing.*closing/)
  })
})
