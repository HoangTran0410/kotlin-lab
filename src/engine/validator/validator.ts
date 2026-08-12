import type { Block, Expr, Program, Stmt } from '../ast/nodes'
import { UNSUPPORTED, type Diagnostic } from './diagnostics'

export function validate(program: Program): Diagnostic[] {
  const out: Diagnostic[] = []

  if (!program.funs.some(f => f.name === 'main')) {
    out.push({
      severity: 'error',
      message: 'Không tìm thấy fun main(). Chương trình cần một điểm vào tên main.',
      line: 1, col: 1,
      hint: 'Thêm: fun main() = runBlocking { ... }',
    })
  }

  const visitExpr = (e: Expr): void => {
    switch (e.k) {
      case 'Ident': {
        const hint = UNSUPPORTED[e.name]
        if (hint) out.push({
          severity: 'error',
          message: `'${e.name}' chưa được hỗ trợ ở phiên bản này.`,
          line: e.pos.line, col: e.pos.col, hint,
        })
        break
      }
      case 'Member': {
        const hint = UNSUPPORTED[e.name]
        if (hint) out.push({
          severity: 'error',
          message: `'${e.name}' chưa được hỗ trợ ở phiên bản này.`,
          line: e.pos.line, col: e.pos.col, hint,
        })
        visitExpr(e.target)
        break
      }
      case 'Call':
        visitExpr(e.callee)
        e.args.forEach(a => visitExpr(a.value))
        if (e.lambda) visitBlock(e.lambda.body)
        break
      case 'Binary': visitExpr(e.left); visitExpr(e.right); break
      case 'Range': visitExpr(e.from); visitExpr(e.to); break
      case 'Unary': visitExpr(e.operand); break
      case 'LambdaExpr': visitBlock(e.lambda.body); break
      case 'IfExpr':
        visitExpr(e.cond); visitBlock(e.thenBlock)
        if (e.elseBlock) visitBlock(e.elseBlock)
        break
      case 'WhenExpr':
        if (e.subject) visitExpr(e.subject)
        e.branches.forEach(b => {
          if (b.cond) visitExpr(b.cond)
          if (b.block) visitBlock(b.block)
          if (b.expr) visitExpr(b.expr)
        })
        break
      case 'StringLit':
        e.parts.forEach(p => { if (p.type === 'expr') visitExpr(p.expr) })
        break
      default: break
    }
  }

  const visitStmt = (s: Stmt): void => {
    switch (s.k) {
      case 'ValDecl': visitExpr(s.init); break
      case 'Assign': visitExpr(s.target); visitExpr(s.value); break
      case 'ExprStmt': visitExpr(s.expr); break
      case 'While': visitExpr(s.cond); visitBlock(s.body); break
      case 'For': visitExpr(s.iterable); visitBlock(s.body); break
      case 'Throw': visitExpr(s.expr); break
      case 'Return': if (s.expr) visitExpr(s.expr); break
      case 'Try':
        visitBlock(s.body)
        s.catches.forEach(c => visitBlock(c.block))
        if (s.finallyBlock) visitBlock(s.finallyBlock)
        break
    }
  }

  const visitBlock = (b: Block): void => b.stmts.forEach(visitStmt)

  program.topLevel.forEach(visitStmt)
  program.funs.forEach(f => {
    f.params.forEach(p => { if (p.defaultValue) visitExpr(p.defaultValue) })
    if (f.body) visitBlock(f.body)
    if (f.exprBody) visitExpr(f.exprBody)
  })

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}
