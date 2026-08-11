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

  it('1..3 tách thành NUMBER, OP(..), NUMBER — không gộp thành một số', () => {
    const toks = tokenize('1..3')
    expect(toks.map(t => [t.kind, t.text])).toEqual([
      ['NUMBER', '1'], ['OP', '..'], ['NUMBER', '3'], ['EOF', ''],
    ])
  })

  it('for (i in 1..10) tokenize đúng — construct khoảng phổ biến nhất', () => {
    const toks = tokenize('for (i in 1..10)')
    expect(toks.filter(t => t.kind === 'NUMBER' || t.kind === 'OP').map(t => t.text))
      .toEqual(['1', '..', '10'])
  })

  it('số thập phân vẫn giữ nguyên dấu chấm', () => {
    expect(tokenize('1.5')[0]).toMatchObject({ kind: 'NUMBER', text: '1.5' })
  })

  it('a.b vẫn là truy cập thành viên, không phải khoảng', () => {
    expect(tokenize('a.b').map(t => t.kind)).toEqual(['IDENT', 'DOT', 'IDENT', 'EOF'])
  })

  it('dấu gạch dưới trong số được loại bỏ', () => {
    expect(tokenize('1_000_000')[0]!.text).toBe('1000000')
  })

  it('ký tự lạ ném lỗi tiếng Việt kèm dòng và cột 1-based', () => {
    expect(() => tokenize('val a\nval #')).toThrow(/không nhận diện được.*dòng 2.*cột 5/)
  })
})
