import { describe, expect, it } from 'vitest'
import { parseExprSource, parseProgram } from '../../src/engine/parser/parser'
import type { Pos } from '../../src/engine/ast/nodes'

describe('parser — expressions', () => {
  it('number literal', () => {
    expect(parseExprSource('42')).toMatchObject({ k: 'NumberLit', value: 42 })
  })

  it('binary operators follow the correct precedence', () => {
    // 1 + 2 * 3  ->  Binary(+, 1, Binary(*, 2, 3))
    expect(parseExprSource('1 + 2 * 3')).toMatchObject({
      k: 'Binary', op: '+',
      left: { k: 'NumberLit', value: 1 },
      right: { k: 'Binary', op: '*' },
    })
  })

  it('comparison has lower precedence than plus/minus', () => {
    expect(parseExprSource('a + 1 > b')).toMatchObject({ k: 'Binary', op: '>' })
  })

  it('chained member access', () => {
    expect(parseExprSource('a.b.c')).toMatchObject({
      k: 'Member', name: 'c', target: { k: 'Member', name: 'b' },
    })
  })

  it('function call with arguments', () => {
    expect(parseExprSource('delay(1000)')).toMatchObject({
      k: 'Call',
      callee: { k: 'Ident', name: 'delay' },
      args: [{ name: null, value: { k: 'NumberLit', value: 1000 } }],
    })
  })

  it('named argument', () => {
    expect(parseExprSource('f(x = 1)')).toMatchObject({
      k: 'Call', args: [{ name: 'x', value: { k: 'NumberLit', value: 1 } }],
    })
  })

  it('a string template becomes a StringLit with an expr part', () => {
    expect(parseExprSource('"n=$x"')).toMatchObject({
      k: 'StringLit',
      parts: [{ type: 'text', value: 'n=' }, { type: 'expr', expr: { k: 'Ident', name: 'x' } }],
    })
  })

  it('the range 1..3', () => {
    expect(parseExprSource('1..3')).toMatchObject({ k: 'Range' })
  })

  it("'..' is looser than plus/minus — 1..n-1 is 1..(n-1), NOT (1..n)-1", () => {
    expect(parseExprSource('1..n-1')).toMatchObject({
      k: 'Range',
      from: { k: 'NumberLit', value: 1 },
      to: { k: 'Binary', op: '-', left: { k: 'Ident', name: 'n' } },
    })
  })

  it("'..' is tighter than comparison — a < 1..n is a < (1..n)", () => {
    expect(parseExprSource('a < 1..n')).toMatchObject({
      k: 'Binary', op: '<', right: { k: 'Range' },
    })
  })

  it('same precedence associates left — 1-2-3 is (1-2)-3', () => {
    expect(parseExprSource('1 - 2 - 3')).toMatchObject({
      k: 'Binary', op: '-',
      left: { k: 'Binary', op: '-', left: { k: 'NumberLit', value: 1 } },
      right: { k: 'NumberLit', value: 3 },
    })
  })

  it('an error inside ${...} reports the REAL position in the file, not the position within the fragment', () => {
    // '"n=${a +}"' — the ')' is missing an operand. '${' is at column 4, so 'a' is at column 6.
    expect(() => parseExprSource('"n=${a +}"')).toThrow()
    try {
      parseExprSource('"n=${a +}"')
    } catch (e) {
      expect((e as { pos: { col: number } }).pos.col).toBeGreaterThanOrEqual(6)
    }
  })

  it('an empty ${} reports a clear error instead of dying on EOF', () => {
    expect(() => parseExprSource('"n=${}"')).toThrow(/empty/)
  })

  it('parentheses change precedence', () => {
    expect(parseExprSource('(1 + 2) * 3')).toMatchObject({
      k: 'Binary', op: '*', left: { k: 'Binary', op: '+' },
    })
  })
})

describe('parser — type arguments', () => {
  it('Channel<Int>() parses as a call to Channel', () => {
    expect(parseExprSource('Channel<Int>()')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'Channel' }, args: [],
    })
  })

  it('nested types MutableStateFlow<List<Int>>(x)', () => {
    expect(parseExprSource('MutableStateFlow<List<Int>>(x)')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'MutableStateFlow' },
      args: [{ value: { k: 'Ident', name: 'x' } }],
    })
  })

  it('a < b is still a comparison, NOT a type argument', () => {
    expect(parseExprSource('a < b')).toMatchObject({ k: 'Binary', op: '<' })
    expect(parseExprSource('x < y + 1')).toMatchObject({ k: 'Binary', op: '<' })
  })

  it('x < y > (z) is a comparison, NOT a generic call', () => {
    // The most dangerous case: it matches the '<' ... '>' then '(' pattern
    // exactly, yet is a comparison. Swallowing it by mistake would produce
    // Call(x,[z]) with NO error reported.
    expect(parseExprSource('x < y > (z)')).toMatchObject({
      k: 'Binary', op: '>',
      left: { k: 'Binary', op: '<', left: { k: 'Ident', name: 'x' } },
    })
  })

  it('a comma between two comparisons inside an argument list is not folded into a type argument', () => {
    // f(a < b, c > (d)) — the comma is in the whitelist, so this is the easy case to get wrong.
    const ast = parseExprSource('f(a < b, c > (d))')
    expect(ast).toMatchObject({ k: 'Call', callee: { k: 'Ident', name: 'f' } })
    expect((ast as { args: unknown[] }).args).toHaveLength(2)
  })
})

describe('parser — position of AST nodes built inside a string template', () => {
  // Task 3 already rebased the position of a ParseError thrown from the nested
  // parser, but the NODES built successfully inside ${...} still kept the
  // fragment's own coordinates (always starting at line 1, column 1). The
  // validator reads that pos directly, so every diagnostic inside a template
  // reported line 1 — pointing at an unrelated line.
  it('a node inside ${...} carries the REAL coordinates of the file, not the fragment\'s', () => {
    const prog = parseProgram(
      'fun main() {\n' +
      '  val a = 1\n' +
      '  println("x ${a.isActive} y")\n' +
      '}')
    const stmt = prog.funs[0]!.body!.stmts[1]!
    const call = (stmt as { expr: { args: { value: { parts: unknown[] } }[] } }).expr
    const part = call.args[0]!.value.parts[1] as { type: string; expr: { pos: Pos } }
    expect(part.type).toBe('expr')
    // 'isActive' is on line 3; column 18 is the 'i' in `  println("x ${a.isActive}`.
    expect(part.expr.pos).toEqual({ line: 3, col: 18 })
  })

  it('multi-level templates: a node at the innermost level also lands on the correct file coordinates', () => {
    const e = parseExprSource('"a ${ "b ${zz}" }"') as { parts: unknown[] }
    const outer = e.parts[1] as { type: string; expr: { parts: unknown[] } }
    const inner = outer.expr.parts[1] as { type: string; expr: { pos: Pos } }
    // `"a ${ "b ${zz}" }"` — 'zz' starts at column 12 (1-based) of the same line 1.
    expect(inner.expr.pos).toEqual({ line: 1, col: 12 })
  })
})
