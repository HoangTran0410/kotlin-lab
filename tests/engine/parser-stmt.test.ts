import { describe, expect, it } from 'vitest'
import { parseBlockSource } from '../../src/engine/parser/parser'

const first = (src: string) => parseBlockSource(`{ ${src} }`).stmts[0]

describe('parser — statements', () => {
  it('val with an initializer', () => {
    expect(first('val x = 1')).toMatchObject({ k: 'ValDecl', name: 'x', mutable: false })
  })

  it('var is flagged mutable', () => {
    expect(first('var x = 1')).toMatchObject({ k: 'ValDecl', name: 'x', mutable: true })
  })

  it('reassigning a variable', () => {
    expect(first('x = 2')).toMatchObject({ k: 'Assign', target: { k: 'Ident', name: 'x' } })
  })

  it('if with else', () => {
    expect(first('if (a) { b() } else { c() }')).toMatchObject({
      k: 'ExprStmt',
      expr: { k: 'IfExpr', elseBlock: { stmts: [{ k: 'ExprStmt' }] } },
    })
  })

  it('while', () => {
    expect(first('while (a) { b() }')).toMatchObject({ k: 'While' })
  })

  it('for over a range', () => {
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

  it('try with no finally', () => {
    expect(first('try { a() } catch (e: Exception) { b() }')).toMatchObject({
      k: 'Try', finallyBlock: null,
    })
  })

  it('throw', () => {
    expect(first('throw RuntimeException("boom")')).toMatchObject({
      k: 'Throw', expr: { k: 'Call', callee: { k: 'Ident', name: 'RuntimeException' } },
    })
  })

  it('return with no value', () => {
    expect(first('return')).toMatchObject({ k: 'Return', expr: null })
  })

  it('when with else', () => {
    // Task 5 (task-1): else is now a WhenBranch with cond: null inside
    // branches, no longer a separate elseBlock field on WhenExpr.
    expect(first('when { a -> { f() } else -> { g() } }')).toMatchObject({
      k: 'ExprStmt',
      expr: {
        k: 'WhenExpr',
        branches: [
          { cond: { k: 'Ident', name: 'a' }, block: {} },
          { cond: null, block: {} },
        ],
      },
    })
  })
})

describe('parser — gaps covered from the Task 5 review', () => {
  it('for (i in 1..n-1): the arithmetic is INSIDE the range, not outside', () => {
    // Pins the '..' precedence fix from Task 3, this time at the statement level.
    expect(first('for (i in 1..n-1) { f(i) }')).toMatchObject({
      k: 'For',
      iterable: { k: 'Range', to: { k: 'Binary', op: '-' } },
    })
  })

  it('return with a value', () => {
    expect(first('return x + 1')).toMatchObject({ k: 'Return', expr: { k: 'Binary', op: '+' } })
  })

  it('return followed by a semicolon is still an empty return', () => {
    expect(first('return;')).toMatchObject({ k: 'Return', expr: null })
  })

  it('when with a subject', () => {
    expect(first('when (x) { 1 -> { f() } else -> { g() } }')).toMatchObject({
      k: 'ExprStmt',
      expr: { k: 'WhenExpr', subject: { k: 'Ident', name: 'x' } },
    })
  })
})
