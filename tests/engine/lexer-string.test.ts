import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — chuỗi và chú thích', () => {
  it('chuỗi thường thành một part text', () => {
    const t = tokenize('"hello"')[0]!
    expect(t.kind).toBe('STRING')
    expect(t.parts).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('template $ident tách thành part expr', () => {
    const t = tokenize('"a $x b"')[0]!
    expect(t.parts).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'expr', source: 'x', line: 1, col: 6 },
      { type: 'text', value: ' b' },
    ])
  })

  it('template ${expr} giữ nguyên biểu thức bên trong', () => {
    const t = tokenize('"n=${a.b(1)}"')[0]!
    expect(t.parts?.[1]).toEqual({ type: 'expr', source: 'a.b(1)', line: 1, col: 6 })
  })

  it('escape sequence được giải mã', () => {
    const t = tokenize('"a\\nb\\$c"')[0]!
    expect(t.parts).toEqual([{ type: 'text', value: 'a\nb$c' }])
  })

  it('bỏ qua chú thích dòng và chú thích khối', () => {
    const toks = tokenize('val a // ghi chú\n/* nhiều\ndòng */ val b')
    expect(toks.filter(t => t.kind === 'IDENT').map(t => t.text)).toEqual(['a', 'b'])
  })

  it('chú thích khối nhiều dòng vẫn đếm đúng số dòng', () => {
    const toks = tokenize('/* a\nb */\nval x')
    expect(toks.find(t => t.text === 'x')!.line).toBe(3)
  })
})
