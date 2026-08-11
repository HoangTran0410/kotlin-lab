import { describe, expect, it } from 'vitest'
import { parseBlockSource } from '../../src/engine/parser/parser'

const first = (src: string) => parseBlockSource(`{ ${src} }`).stmts[0]

describe('parser — câu lệnh', () => {
  it('val có khởi tạo', () => {
    expect(first('val x = 1')).toMatchObject({ k: 'ValDecl', name: 'x', mutable: false })
  })

  it('var đánh dấu mutable', () => {
    expect(first('var x = 1')).toMatchObject({ k: 'ValDecl', name: 'x', mutable: true })
  })

  it('gán lại biến', () => {
    expect(first('x = 2')).toMatchObject({ k: 'Assign', target: { k: 'Ident', name: 'x' } })
  })

  it('if có else', () => {
    expect(first('if (a) { b() } else { c() }')).toMatchObject({
      k: 'ExprStmt',
      expr: { k: 'IfExpr', elseBlock: { stmts: [{ k: 'ExprStmt' }] } },
    })
  })

  it('while', () => {
    expect(first('while (a) { b() }')).toMatchObject({ k: 'While' })
  })

  it('for trên khoảng', () => {
    expect(first('for (i in 1..3) { f(i) }')).toMatchObject({
      k: 'For', name: 'i', iterable: { k: 'Range' },
    })
  })

  it('try/catch/finally', () => {
    expect(first('try { a() } catch (e: Exception) { b() } finally { c() }')).toMatchObject({
      k: 'Try',
      catches: [{ name: 'e', type: 'Exception' }],
      finallyBlock: { stmts: [{ k: 'ExprStmt' }] },
    })
  })

  it('try không có finally', () => {
    expect(first('try { a() } catch (e: Exception) { b() }')).toMatchObject({
      k: 'Try', finallyBlock: null,
    })
  })

  it('throw', () => {
    expect(first('throw RuntimeException("boom")')).toMatchObject({
      k: 'Throw', expr: { k: 'Call', callee: { k: 'Ident', name: 'RuntimeException' } },
    })
  })

  it('return không có giá trị', () => {
    expect(first('return')).toMatchObject({ k: 'Return', expr: null })
  })

  it('when có else', () => {
    expect(first('when { a -> { f() } else -> { g() } }')).toMatchObject({
      k: 'ExprStmt', expr: { k: 'WhenExpr', branches: [{}], elseBlock: {} },
    })
  })
})
