import { describe, expect, it } from 'vitest'
import { parseBlockSource, parseExprSource } from '../../src/engine/parser/parser'

describe('parser — lambda', () => {
  it('trailing lambda không có ngoặc đơn: launch { }', () => {
    expect(parseExprSource('launch { }')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'launch' }, args: [],
      lambda: { params: [] },
    })
  })

  it('trailing lambda sau đối số: launch(Dispatchers.IO) { }', () => {
    expect(parseExprSource('launch(Dispatchers.IO) { }')).toMatchObject({
      k: 'Call',
      args: [{ value: { k: 'Member', name: 'IO' } }],
      lambda: { params: [] },
    })
  })

  it('lambda có tham số đặt tên: handler { ctx, e -> }', () => {
    expect(parseExprSource('handler { ctx, e -> }')).toMatchObject({
      k: 'Call', lambda: { params: ['ctx', 'e'] },
    })
  })

  it('lambda lồng nhau', () => {
    const ast = parseExprSource('launch { launch { } }')
    expect(ast).toMatchObject({
      k: 'Call',
      lambda: { body: { stmts: [{ k: 'ExprStmt', expr: { k: 'Call', callee: { k: 'Ident', name: 'launch' } } }] } },
    })
  })

  it('lambda đứng riêng làm biểu thức', () => {
    expect(parseExprSource('{ x -> x }')).toMatchObject({
      k: 'LambdaExpr', lambda: { params: ['x'] },
    })
  })

  it('gọi chuỗi rồi trailing lambda: scope.launch { }', () => {
    expect(parseExprSource('scope.launch { }')).toMatchObject({
      k: 'Call',
      callee: { k: 'Member', target: { k: 'Ident', name: 'scope' }, name: 'launch' },
      lambda: { params: [] },
    })
  })
})

describe('parser — ranh giới trailing lambda', () => {
  it('khối ở DÒNG SAU không bị nuốt thành trailing lambda', () => {
    // `f()` kết thúc ở dòng 1. `{ g() }` ở dòng 2 là khối rời.
    const blk = parseBlockSource('{ f()\n{ g() } }')
    expect(blk.stmts).toHaveLength(2)
    expect(blk.stmts[0]).toMatchObject({ k: 'ExprStmt', expr: { k: 'Call', lambda: null } })
  })

  it('khối cùng dòng thì vẫn là trailing lambda', () => {
    const blk = parseBlockSource('{ f() { g() } }')
    expect(blk.stmts).toHaveLength(1)
    expect(blk.stmts[0]).toMatchObject({ k: 'ExprStmt', expr: { k: 'Call', lambda: {} } })
  })
})
