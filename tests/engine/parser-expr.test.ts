import { describe, expect, it } from 'vitest'
import { parseExprSource, parseProgram } from '../../src/engine/parser/parser'
import type { Pos } from '../../src/engine/ast/nodes'

describe('parser — biểu thức', () => {
  it('literal số', () => {
    expect(parseExprSource('42')).toMatchObject({ k: 'NumberLit', value: 42 })
  })

  it('toán tử nhị phân theo đúng độ ưu tiên', () => {
    // 1 + 2 * 3  ->  Binary(+, 1, Binary(*, 2, 3))
    expect(parseExprSource('1 + 2 * 3')).toMatchObject({
      k: 'Binary', op: '+',
      left: { k: 'NumberLit', value: 1 },
      right: { k: 'Binary', op: '*' },
    })
  })

  it('so sánh có độ ưu tiên thấp hơn cộng trừ', () => {
    expect(parseExprSource('a + 1 > b')).toMatchObject({ k: 'Binary', op: '>' })
  })

  it('truy cập thành viên nối chuỗi', () => {
    expect(parseExprSource('a.b.c')).toMatchObject({
      k: 'Member', name: 'c', target: { k: 'Member', name: 'b' },
    })
  })

  it('lời gọi hàm có đối số', () => {
    expect(parseExprSource('delay(1000)')).toMatchObject({
      k: 'Call',
      callee: { k: 'Ident', name: 'delay' },
      args: [{ name: null, value: { k: 'NumberLit', value: 1000 } }],
    })
  })

  it('đối số có tên', () => {
    expect(parseExprSource('f(x = 1)')).toMatchObject({
      k: 'Call', args: [{ name: 'x', value: { k: 'NumberLit', value: 1 } }],
    })
  })

  it('string template thành StringLit có part expr', () => {
    expect(parseExprSource('"n=$x"')).toMatchObject({
      k: 'StringLit',
      parts: [{ type: 'text', value: 'n=' }, { type: 'expr', expr: { k: 'Ident', name: 'x' } }],
    })
  })

  it('khoảng 1..3', () => {
    expect(parseExprSource('1..3')).toMatchObject({ k: 'Range' })
  })

  it("'..' lỏng hơn cộng trừ — 1..n-1 là 1..(n-1), KHÔNG phải (1..n)-1", () => {
    expect(parseExprSource('1..n-1')).toMatchObject({
      k: 'Range',
      from: { k: 'NumberLit', value: 1 },
      to: { k: 'Binary', op: '-', left: { k: 'Ident', name: 'n' } },
    })
  })

  it("'..' chặt hơn so sánh — a < 1..n là a < (1..n)", () => {
    expect(parseExprSource('a < 1..n')).toMatchObject({
      k: 'Binary', op: '<', right: { k: 'Range' },
    })
  })

  it('cùng độ ưu tiên thì kết hợp trái — 1-2-3 là (1-2)-3', () => {
    expect(parseExprSource('1 - 2 - 3')).toMatchObject({
      k: 'Binary', op: '-',
      left: { k: 'Binary', op: '-', left: { k: 'NumberLit', value: 1 } },
      right: { k: 'NumberLit', value: 3 },
    })
  })

  it('lỗi trong ${...} báo vị trí THẬT trong file, không phải vị trí trong mẩu', () => {
    // '"n=${a +}"' — dấu ')' thiếu toán hạng. '${' ở cột 4, nên 'a' ở cột 6.
    expect(() => parseExprSource('"n=${a +}"')).toThrow()
    try {
      parseExprSource('"n=${a +}"')
    } catch (e) {
      expect((e as { pos: { col: number } }).pos.col).toBeGreaterThanOrEqual(6)
    }
  })

  it('${} rỗng báo lỗi rõ ràng thay vì chết vì EOF', () => {
    expect(() => parseExprSource('"n=${}"')).toThrow(/rỗng/)
  })

  it('ngoặc đơn đổi độ ưu tiên', () => {
    expect(parseExprSource('(1 + 2) * 3')).toMatchObject({
      k: 'Binary', op: '*', left: { k: 'Binary', op: '+' },
    })
  })
})

describe('parser — đối số kiểu', () => {
  it('Channel<Int>() parse thành lời gọi Channel', () => {
    expect(parseExprSource('Channel<Int>()')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'Channel' }, args: [],
    })
  })

  it('kiểu lồng nhau MutableStateFlow<List<Int>>(x)', () => {
    expect(parseExprSource('MutableStateFlow<List<Int>>(x)')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'MutableStateFlow' },
      args: [{ value: { k: 'Ident', name: 'x' } }],
    })
  })

  it('a < b vẫn là so sánh, KHÔNG phải đối số kiểu', () => {
    expect(parseExprSource('a < b')).toMatchObject({ k: 'Binary', op: '<' })
    expect(parseExprSource('x < y + 1')).toMatchObject({ k: 'Binary', op: '<' })
  })

  it('x < y > (z) là so sánh chứ KHÔNG phải lời gọi generic', () => {
    // Ca nguy hiểm nhất: khớp đúng mẫu '<' ... '>' rồi '(' nhưng lại là
    // so sánh. Nếu nuốt nhầm sẽ ra Call(x,[z]) và KHÔNG báo lỗi gì.
    expect(parseExprSource('x < y > (z)')).toMatchObject({
      k: 'Binary', op: '>',
      left: { k: 'Binary', op: '<', left: { k: 'Ident', name: 'x' } },
    })
  })

  it('dấu phẩy giữa hai so sánh trong đối số không bị gộp thành đối số kiểu', () => {
    // f(a < b, c > (d)) — dấu phẩy nằm trong whitelist nên đây là ca dễ lọt.
    const ast = parseExprSource('f(a < b, c > (d))')
    expect(ast).toMatchObject({ k: 'Call', callee: { k: 'Ident', name: 'f' } })
    expect((ast as { args: unknown[] }).args).toHaveLength(2)
  })
})

describe('parser — vị trí của AST dựng trong string template', () => {
  // Task 3 đã quy vị trí của ParseError ném ra từ parser lồng về toạ độ file,
  // nhưng các NODE dựng thành công bên trong ${...} vẫn giữ toạ độ của mẩu
  // (luôn bắt đầu từ dòng 1, cột 1). Validator đọc thẳng pos đó nên mọi chẩn
  // đoán bên trong template đều báo dòng 1 — trỏ vào một dòng không liên quan.
  it('node bên trong ${...} mang toạ độ THẬT của file, không phải của mẩu', () => {
    const prog = parseProgram(
      'fun main() {\n' +
      '  val a = 1\n' +
      '  println("x ${a.isActive} y")\n' +
      '}')
    const stmt = prog.funs[0]!.body!.stmts[1]!
    const call = (stmt as { expr: { args: { value: { parts: unknown[] } }[] } }).expr
    const part = call.args[0]!.value.parts[1] as { type: string; expr: { pos: Pos } }
    expect(part.type).toBe('expr')
    // 'isActive' nằm ở dòng 3; cột 18 là chữ 'i' trong `  println("x ${a.isActive}`.
    expect(part.expr.pos).toEqual({ line: 3, col: 18 })
  })

  it('template nhiều tầng: node ở tầng trong cùng cũng về đúng toạ độ file', () => {
    const e = parseExprSource('"a ${ "b ${zz}" }"') as { parts: unknown[] }
    const outer = e.parts[1] as { type: string; expr: { parts: unknown[] } }
    const inner = outer.expr.parts[1] as { type: string; expr: { pos: Pos } }
    // `"a ${ "b ${zz}" }"` — 'zz' bắt đầu ở cột 12 (1-based) của cùng dòng 1.
    expect(inner.expr.pos).toEqual({ line: 1, col: 12 })
  })
})
