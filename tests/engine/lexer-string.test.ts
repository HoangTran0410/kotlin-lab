import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — chuỗi và chú thích', () => {
  it('chuỗi thường thành một part text', () => {
    const t = tokenize('"hello"')[0]!
    expect(t.kind).toBe('STRING')
    expect(t.parts).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('template $ident tách thành part expr', () => {
    // "a $x b" -> cột 1='"' 2='a' 3=' ' 4='$' 5='x'. Part expr phải trỏ vào
    // vị trí BẮT ĐẦU của biểu thức (cột 5), giống hệt cách ${...} làm.
    const t = tokenize('"a $x b"')[0]!
    expect(t.parts).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'expr', source: 'x', line: 1, col: 5 },
      { type: 'text', value: ' b' },
    ])
  })

  it('$ident nhiều ký tự vẫn trỏ vào ký tự đầu tiên', () => {
    const t = tokenize('"$name"')[0]!
    expect(t.parts).toEqual([{ type: 'expr', source: 'name', line: 1, col: 3 }])
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

  it('nội dung trong chú thích không sinh token nào', () => {
    // Test này thực sự kiểm tra việc bỏ qua chú thích: nếu comment không được
    // xử lý thì 'val' và 'b' bên trong sẽ lọt ra thành token.
    const toks = tokenize('/* val b = 1 */ val a')
    expect(toks.filter(t => t.kind === 'IDENT' || t.kind === 'KEYWORD').map(t => t.text))
      .toEqual(['val', 'a'])
  })

  it('chú thích khối nhiều dòng vẫn đếm đúng số dòng', () => {
    const toks = tokenize('/* a\nb */\nval x')
    expect(toks.find(t => t.text === 'x')!.line).toBe(3)
  })

  it('lambda lồng trong ${} không làm part kết thúc sớm', () => {
    const t = tokenize('"${list.map { it }}"')[0]!
    expect(t.parts).toEqual([{ type: 'expr', source: 'list.map { it }', line: 1, col: 4 }])
  })

  it('$ đứng một mình là ký tự thường, không phải template', () => {
    expect(tokenize('"giá 5$ thôi"')[0]!.parts).toEqual([{ type: 'text', value: 'giá 5$ thôi' }])
  })

  it('$ theo sau bởi chữ số không phải template', () => {
    expect(tokenize('"$5"')[0]!.parts).toEqual([{ type: 'text', value: '$5' }])
  })

  it('chuỗi chưa đóng ném lỗi tiếng Việt kèm vị trí mở', () => {
    expect(() => tokenize('val s = "abc')).toThrow(/chuỗi chưa được đóng.*dòng 1.*cột 9/)
  })

  it('chú thích khối chưa đóng ném lỗi tiếng Việt', () => {
    expect(() => tokenize('val a\n/* chưa đóng')).toThrow(/chú thích khối chưa được đóng.*dòng 2/)
  })

  it('${ chưa đóng ném lỗi tiếng Việt', () => {
    expect(() => tokenize('"n=${a"')).toThrow(/thiếu .* đóng/)
  })
})
