import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — core', () => {
  it('splits identifiers, keywords and numbers', () => {
    const toks = tokenize('val x = 42')
    expect(toks.map(t => [t.kind, t.text])).toEqual([
      ['KEYWORD', 'val'], ['IDENT', 'x'], ['OP', '='], ['NUMBER', '42'], ['EOF', ''],
    ])
  })

  it('records the correct 1-based line and column', () => {
    const toks = tokenize('val a\nval b')
    const b = toks.find(t => t.text === 'b')!
    expect({ line: b.line, col: b.col }).toEqual({ line: 2, col: 5 })
  })

  it('recognizes parentheses and the dot', () => {
    const toks = tokenize('launch(a.b)')
    expect(toks.map(t => t.kind)).toEqual(
      ['IDENT', 'LPAREN', 'IDENT', 'DOT', 'IDENT', 'RPAREN', 'EOF'])
  })

  it('multi-character operators are not split apart', () => {
    const toks = tokenize('a >= b && c != d')
    expect(toks.filter(t => t.kind === 'OP').map(t => t.text)).toEqual(['>=', '&&', '!='])
  })

  it('1..3 splits into NUMBER, OP(..), NUMBER — not merged into one number', () => {
    const toks = tokenize('1..3')
    expect(toks.map(t => [t.kind, t.text])).toEqual([
      ['NUMBER', '1'], ['OP', '..'], ['NUMBER', '3'], ['EOF', ''],
    ])
  })

  it('for (i in 1..10) tokenizes correctly — the most common range construct', () => {
    const toks = tokenize('for (i in 1..10)')
    expect(toks.filter(t => t.kind === 'NUMBER' || t.kind === 'OP').map(t => t.text))
      .toEqual(['1', '..', '10'])
  })

  it('a decimal number keeps its dot', () => {
    expect(tokenize('1.5')[0]).toMatchObject({ kind: 'NUMBER', text: '1.5' })
  })

  it('a.b is still member access, not a range', () => {
    expect(tokenize('a.b').map(t => t.kind)).toEqual(['IDENT', 'DOT', 'IDENT', 'EOF'])
  })

  it('underscores in a number are stripped', () => {
    expect(tokenize('1_000_000')[0]!.text).toBe('1000000')
  })

  it('an unrecognized character throws with a 1-based line and column', () => {
    expect(() => tokenize('val a\nval #')).toThrow(/unrecognized character.*line 2.*column 5/)
  })
})
