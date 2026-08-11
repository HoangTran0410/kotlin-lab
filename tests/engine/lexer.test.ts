import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — lõi', () => {
  it('tách định danh, từ khoá và số', () => {
    const toks = tokenize('val x = 42')
    expect(toks.map(t => [t.kind, t.text])).toEqual([
      ['KEYWORD', 'val'], ['IDENT', 'x'], ['OP', '='], ['NUMBER', '42'], ['EOF', ''],
    ])
  })

  it('ghi đúng dòng và cột 1-based', () => {
    const toks = tokenize('val a\nval b')
    const b = toks.find(t => t.text === 'b')!
    expect({ line: b.line, col: b.col }).toEqual({ line: 2, col: 5 })
  })

  it('nhận diện dấu ngoặc và dấu chấm', () => {
    const toks = tokenize('launch(a.b)')
    expect(toks.map(t => t.kind)).toEqual(
      ['IDENT', 'LPAREN', 'IDENT', 'DOT', 'IDENT', 'RPAREN', 'EOF'])
  })

  it('toán tử nhiều ký tự không bị tách rời', () => {
    const toks = tokenize('a >= b && c != d')
    expect(toks.filter(t => t.kind === 'OP').map(t => t.text)).toEqual(['>=', '&&', '!='])
  })
})
