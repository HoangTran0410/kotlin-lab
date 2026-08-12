import { describe, expect, it } from 'vitest'
import { parseBlockSource, parseExprSource } from '../../src/engine/parser/parser'

describe('parser — lambda', () => {
  it('a trailing lambda with no parentheses: launch { }', () => {
    expect(parseExprSource('launch { }')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'launch' }, args: [],
      lambda: { params: [] },
    })
  })

  it('a trailing lambda after an argument: launch(Dispatchers.IO) { }', () => {
    expect(parseExprSource('launch(Dispatchers.IO) { }')).toMatchObject({
      k: 'Call',
      args: [{ value: { k: 'Member', name: 'IO' } }],
      lambda: { params: [] },
    })
  })

  it('a lambda with named parameters: handler { ctx, e -> }', () => {
    expect(parseExprSource('handler { ctx, e -> }')).toMatchObject({
      k: 'Call', lambda: { params: ['ctx', 'e'] },
    })
  })

  it('nested lambdas', () => {
    const ast = parseExprSource('launch { launch { } }')
    expect(ast).toMatchObject({
      k: 'Call',
      lambda: { body: { stmts: [{ k: 'ExprStmt', expr: { k: 'Call', callee: { k: 'Ident', name: 'launch' } } }] } },
    })
  })

  it('a standalone lambda used as an expression', () => {
    expect(parseExprSource('{ x -> x }')).toMatchObject({
      k: 'LambdaExpr', lambda: { params: ['x'] },
    })
  })

  it('a chained call then a trailing lambda: scope.launch { }', () => {
    expect(parseExprSource('scope.launch { }')).toMatchObject({
      k: 'Call',
      callee: { k: 'Member', target: { k: 'Ident', name: 'scope' }, name: 'launch' },
      lambda: { params: [] },
    })
  })
})

describe('parser — trailing lambda boundary', () => {
  it('a block on the NEXT LINE is not swallowed as a trailing lambda', () => {
    // `f()` ends on line 1. `{ g() }` on line 2 is a standalone block.
    const blk = parseBlockSource('{ f()\n{ g() } }')
    expect(blk.stmts).toHaveLength(2)
    expect(blk.stmts[0]).toMatchObject({ k: 'ExprStmt', expr: { k: 'Call', lambda: null } })
  })

  it('a block on the same line is still a trailing lambda', () => {
    const blk = parseBlockSource('{ f() { g() } }')
    expect(blk.stmts).toHaveLength(1)
    expect(blk.stmts[0]).toMatchObject({ k: 'ExprStmt', expr: { k: 'Call', lambda: {} } })
  })
})
