import type { Block, Expr, Program, Stmt } from '../ast/nodes'
import { UNSUPPORTED, type Diagnostic } from './diagnostics'

/**
 * Builder tạo/chạy thân coroutine — CHÍNH XÁC tập tên mà `tryBuilder` trong
 * interpreter.ts nhận diện. Chỉ thân lambda của những lời gọi này mới có
 * CoroutineScope bao quanh; đây là điều kiện để `isActive` trần/`ensureActive()`
 * hợp lệ (Kotlin thật: cả hai là extension trên CoroutineScope/CoroutineContext).
 */
const COROUTINE_BUILDERS = new Set([
  'launch', 'async', 'runBlocking', 'coroutineScope', 'supervisorScope', 'withContext',
])

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

  // `inCoroutine`: đang duyệt bên trong thân lambda của một builder ở trên
  // (lồng bao nhiêu tầng không quan trọng — while/for/if/try/lambda thường
  // như của repeat() đều KẾ THỪA cờ này, không tự đổi biên coroutine). Mặc
  // định false: thân `fun` bất kỳ (kể cả main dạng block) không tự nhiên có
  // CoroutineScope, đúng như Kotlin thật báo "Unresolved reference" cho
  // `isActive trần`/`ensureActive()` viết ngoài mọi builder.
  const visitExpr = (e: Expr, inCoroutine: boolean): void => {
    switch (e.k) {
      case 'Ident': {
        if ((e.name === 'isActive' || e.name === 'ensureActive') && !inCoroutine) {
          out.push({
            severity: 'error',
            message: `'${e.name}' chỉ dùng được bên trong coroutine — Kotlin thật báo `
              + `unresolved reference ở ngoài thân launch/async/runBlocking/coroutineScope/`
              + 'supervisorScope/withContext.',
            line: e.pos.line, col: e.pos.col,
            hint: 'Đặt bên trong thân một trong các builder trên, hoặc đọc qua biến Job cụ thể (job.isActive).',
          })
        }
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
        visitExpr(e.target, inCoroutine)
        break
      }
      case 'Call': {
        visitExpr(e.callee, inCoroutine)
        e.args.forEach(a => visitExpr(a.value, inCoroutine))
        if (e.lambda) {
          const calleeName = e.callee.k === 'Ident' ? e.callee.name
            : e.callee.k === 'Member' ? e.callee.name : null
          const bodyInCoroutine = inCoroutine || (calleeName !== null && COROUTINE_BUILDERS.has(calleeName))
          visitBlock(e.lambda.body, bodyInCoroutine)
        }
        break
      }
      case 'Binary': visitExpr(e.left, inCoroutine); visitExpr(e.right, inCoroutine); break
      case 'Range': visitExpr(e.from, inCoroutine); visitExpr(e.to, inCoroutine); break
      case 'Unary': visitExpr(e.operand, inCoroutine); break
      case 'LambdaExpr': visitBlock(e.lambda.body, inCoroutine); break
      case 'IfExpr':
        visitExpr(e.cond, inCoroutine); visitBlock(e.thenBlock, inCoroutine)
        if (e.elseBlock) visitBlock(e.elseBlock, inCoroutine)
        break
      case 'WhenExpr':
        if (e.subject) visitExpr(e.subject, inCoroutine)
        e.branches.forEach(b => {
          if (b.cond) visitExpr(b.cond, inCoroutine)
          if (b.block) visitBlock(b.block, inCoroutine)
          if (b.expr) visitExpr(b.expr, inCoroutine)
        })
        break
      case 'StringLit':
        e.parts.forEach(p => { if (p.type === 'expr') visitExpr(p.expr, inCoroutine) })
        break
      default: break
    }
  }

  const visitStmt = (s: Stmt, inCoroutine: boolean): void => {
    switch (s.k) {
      case 'ValDecl': visitExpr(s.init, inCoroutine); break
      case 'Assign': visitExpr(s.target, inCoroutine); visitExpr(s.value, inCoroutine); break
      case 'ExprStmt': visitExpr(s.expr, inCoroutine); break
      case 'While': visitExpr(s.cond, inCoroutine); visitBlock(s.body, inCoroutine); break
      case 'For': visitExpr(s.iterable, inCoroutine); visitBlock(s.body, inCoroutine); break
      case 'Throw': visitExpr(s.expr, inCoroutine); break
      case 'Return': if (s.expr) visitExpr(s.expr, inCoroutine); break
      case 'Try':
        visitBlock(s.body, inCoroutine)
        s.catches.forEach(c => visitBlock(c.block, inCoroutine))
        if (s.finallyBlock) visitBlock(s.finallyBlock, inCoroutine)
        break
    }
  }

  const visitBlock = (b: Block, inCoroutine: boolean): void => b.stmts.forEach(s => visitStmt(s, inCoroutine))

  program.topLevel.forEach(s => visitStmt(s, false))
  program.funs.forEach(f => {
    f.params.forEach(p => { if (p.defaultValue) visitExpr(p.defaultValue, false) })
    if (f.body) visitBlock(f.body, false)
    if (f.exprBody) visitExpr(f.exprBody, false)
  })

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}
