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

  // Ngăn xếp scope: mỗi phần tử là tập tên đã khai (ValDecl/tham số hàm/tham
  // số lambda/biến catch/biến vòng for) TRONG đúng block đó. `isDeclared` tra
  // CẢ ngăn xếp — giống hệt chuỗi cha mà `Env.get`/`Env.has` (interpreter/env.ts)
  // tra lúc chạy. Cần để KHÔNG báo lỗi cho `val isActive = true` tự người học
  // khai: đúng tiền lệ interpreter.ts:119 đã có (`!env.has('isActive')`), nếu
  // validator không biết biến đã khai thì nó chặn nhầm code hợp lệ 100% trên
  // Kotlin thật. Luôn có ít nhất một phần tử gốc, không bao giờ pop hết.
  const scopes: Set<string>[] = [new Set()]
  const isDeclared = (name: string): boolean => scopes.some(sc => sc.has(name))
  const declare = (name: string): void => { scopes[scopes.length - 1]!.add(name) }

  // `inCoroutine`: đang duyệt bên trong thân lambda của một builder ở trên
  // (lồng bao nhiêu tầng không quan trọng — while/for/if/try/lambda thường
  // như của repeat() đều KẾ THỪA cờ này, không tự đổi biên coroutine). Mặc
  // định false: thân `fun` bất kỳ (kể cả main dạng block) không tự nhiên có
  // CoroutineScope, đúng như Kotlin thật báo "Unresolved reference" cho
  // `isActive trần`/`ensureActive()` viết ngoài mọi builder.
  const visitExpr = (e: Expr, inCoroutine: boolean): void => {
    switch (e.k) {
      case 'Ident': {
        if ((e.name === 'isActive' || e.name === 'ensureActive') && !inCoroutine && !isDeclared(e.name)) {
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
          visitBlockWithNames(e.lambda.body, bodyInCoroutine, e.lambda.params)
        }
        break
      }
      case 'Binary': visitExpr(e.left, inCoroutine); visitExpr(e.right, inCoroutine); break
      case 'Range': visitExpr(e.from, inCoroutine); visitExpr(e.to, inCoroutine); break
      case 'Unary': visitExpr(e.operand, inCoroutine); break
      case 'LambdaExpr': visitBlockWithNames(e.lambda.body, inCoroutine, e.lambda.params); break
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
      // Khai báo SAU khi duyệt init — đúng thứ tự runtime thật (Env.declare
      // chạy sau evalExpr(s.init)), nên `val isActive = isActive` (không có gì
      // bao quanh) vẫn báo lỗi ở vế phải như Kotlin thật, không tự che chính nó.
      case 'ValDecl': visitExpr(s.init, inCoroutine); declare(s.name); break
      case 'Assign': visitExpr(s.target, inCoroutine); visitExpr(s.value, inCoroutine); break
      case 'ExprStmt': visitExpr(s.expr, inCoroutine); break
      case 'While': visitExpr(s.cond, inCoroutine); visitBlock(s.body, inCoroutine); break
      case 'For': visitExpr(s.iterable, inCoroutine); visitBlockWithNames(s.body, inCoroutine, [s.name]); break
      case 'Throw': visitExpr(s.expr, inCoroutine); break
      case 'Return': if (s.expr) visitExpr(s.expr, inCoroutine); break
      case 'Try':
        visitBlock(s.body, inCoroutine)
        s.catches.forEach(c => visitBlockWithNames(c.block, inCoroutine, [c.name]))
        if (s.finallyBlock) visitBlock(s.finallyBlock, inCoroutine)
        break
    }
  }

  // Block LUÔN mở một scope riêng (khớp `env.child()` lúc chạy cho while/for/
  // try/if/lambda...) và pop lại khi ra — đây là điều khiến ca "biến khai
  // trong block không rò ra ngoài" phân biệt được: bỏ dòng `scopes.pop()` là
  // đúng phép phá mà test đó canh.
  const visitBlockWithNames = (b: Block, inCoroutine: boolean, names: readonly string[]): void => {
    scopes.push(new Set())
    names.forEach(declare)
    b.stmts.forEach(s => visitStmt(s, inCoroutine))
    scopes.pop()
  }
  const visitBlock = (b: Block, inCoroutine: boolean): void => visitBlockWithNames(b, inCoroutine, [])

  program.topLevel.forEach(s => visitStmt(s, false))
  program.funs.forEach(f => {
    scopes.push(new Set())
    f.params.forEach(p => { declare(p.name); if (p.defaultValue) visitExpr(p.defaultValue, false) })
    if (f.body) visitBlock(f.body, false)
    if (f.exprBody) visitExpr(f.exprBody, false)
    scopes.pop()
  })

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}
