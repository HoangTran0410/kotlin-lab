import type { Block, Expr, Pos, Program, Stmt } from '../ast/nodes'
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

/**
 * Tra bảng UNSUPPORTED mà KHÔNG chạm tới Object.prototype.
 *
 * `UNSUPPORTED[name]` trần đọc trúng cả thành viên kế thừa: `toString`,
 * `valueOf`, `constructor`, `hasOwnProperty`... Đã đo trước khi sửa —
 * `i.toString()` (một trong những lời gọi phổ biến nhất của Kotlin) bị báo
 * "'toString' chưa được hỗ trợ", còn `hint` là một HÀM lọt thẳng ra UI; và một
 * biến tên `valueOf` cũng bị chặn dù chẳng liên quan gì.
 */
function goiYChuaHoTro(name: string): string | undefined {
  return Object.hasOwn(UNSUPPORTED, name) ? UNSUPPORTED[name] : undefined
}

/**
 * Tên dùng được mà không cần khai báo — mọi thứ interpreter tự nhận ra.
 *
 * Chỉ liệt kê tên viết THƯỜNG: định danh viết hoa chữ đầu được coi là tên
 * kiểu/hàm dựng (`RuntimeException("x")`, `Dispatchers.IO`, `GlobalScope`,
 * `SupervisorJob()`) và không bao giờ bị hỏi tới — đúng như interpreter làm
 * (`/^[A-Z]/` -> dựng object).
 *
 * Danh sách này phải khớp với evalCall/trySuspensionPoint/tryBuilder. Thứ canh
 * nó không trôi lệch là chính bộ bài học và bộ ví dụ: 13 lesson và 19 ví dụ
 * trong trang giới thiệu đều được chạy qua `validate` trong test và phải sạch
 * chẩn đoán. Bỏ sót một tên ở đây thì có bài đỏ ngay.
 */
const TEN_CO_SAN = new Set([
  // Đọc được như một GIÁ TRỊ, không cần khai báo.
  'it',        // tham số ngầm của lambda một tham số
  'this',      // receiver của scope bao quanh — `work(this)`
  'isActive',  // property của CoroutineScope; đã có kiểm riêng cho chỗ dùng sai
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
  /**
   * Ba phép kiểm trên một định danh. `laCallee` = định danh đang ở vị trí GỌI
   * (`foo(...)`), khác hẳn vị trí giá trị (`foo`, `foo.bar`).
   *
   * Tách ra vì cả hai vị trí đều cần hai phép kiểm đầu — `ensureActive()` ngoài
   * coroutine phải báo, và `withTimeout(...)` chưa hỗ trợ cũng phải báo — nhưng
   * chỉ vị trí GIÁ TRỊ mới cần phép kiểm "đã khai báo chưa".
   */
  const kiemIdent = (name: string, pos: Pos, inCoroutine: boolean, laCallee: boolean): void => {
    if ((name === 'isActive' || name === 'ensureActive') && !inCoroutine && !isDeclared(name)) {
      out.push({
        severity: 'error',
        message: `'${name}' chỉ dùng được bên trong coroutine — Kotlin thật báo `
          + `unresolved reference ở ngoài thân launch/async/runBlocking/coroutineScope/`
          + 'supervisorScope/withContext.',
        line: pos.line, col: pos.col,
        hint: 'Đặt bên trong thân một trong các builder trên, hoặc đọc qua biến Job cụ thể (job.isActive).',
      })
    }
    const hint = goiYChuaHoTro(name)
    if (hint) {
      out.push({
        severity: 'error',
        message: `'${name}' chưa được hỗ trợ ở phiên bản này.`,
        line: pos.line, col: pos.col, hint,
      })
      return
    }
    // Tên viết thường, dùng như một GIÁ TRỊ, mà chưa khai báo ở đâu cả.
    //
    // Ca đã gặp thật: `supervisorScope.launch { }` khi quên khai báo
    // `val supervisorScope = CoroutineScope(...)`. Kotlin thật không biên dịch
    // được ("Unresolved reference"); engine thì im lặng dựng ra một object rác
    // mang đúng cái tên ấy, `scopeReceiver` không nhận ra nó, nên lời gọi chạy
    // y hệt `launch { }` trần — cùng cha, cùng luật. Bài học về supervisor
    // lặng lẽ dạy ngược mà không ai báo gì.
    //
    // Hai giới hạn CỐ Ý, nói rõ để không ai tưởng nó canh nhiều hơn:
    //   - Chỉ tên viết thường. Viết hoa chữ đầu là tên kiểu/hàm dựng và
    //     interpreter cố ý dựng object cho chúng (`RuntimeException("x")`).
    //   - Chỉ vị trí GIÁ TRỊ. Hàm chưa biết là chuyện khác: `flowOf(1)` là hàm
    //     có thật của kotlinx mà engine chưa cài, và Flow thuộc milestone sau.
    //     Gộp hai chuyện vào một câu báo sẽ nói sai một trong hai.
    if (!laCallee && !/^[A-Z]/.test(name) && !TEN_CO_SAN.has(name) && !isDeclared(name)) {
      out.push({
        severity: 'error',
        message: `'${name}' chưa được khai báo — Kotlin thật báo "Unresolved reference".`,
        line: pos.line, col: pos.col,
        hint: 'Kiểm tra chính tả, hoặc khai báo bằng val/var trước khi dùng.',
      })
    }
  }

  const visitExpr = (e: Expr, inCoroutine: boolean): void => {
    switch (e.k) {
      case 'Ident': kiemIdent(e.name, e.pos, inCoroutine, false); break
      case 'Member': {
        const hint = goiYChuaHoTro(e.name)
        if (hint) out.push({
          severity: 'error',
          message: `'${e.name}' chưa được hỗ trợ ở phiên bản này.`,
          line: e.pos.line, col: e.pos.col, hint,
        })
        visitExpr(e.target, inCoroutine)
        break
      }
      case 'Call': {
        // Callee dạng Ident KHÔNG đi qua phép kiểm "đã khai báo chưa" ở case
        // 'Ident': tên hàm dựng sẵn (`launch`, `delay`, `println`...) không nằm
        // trong scope nào, và hàm chưa biết thì thuộc diện khác (xem ghi chú ở
        // case 'Ident'). Vẫn duyệt để bắt UNSUPPORTED như cũ.
        if (e.callee.k === 'Ident') kiemIdent(e.callee.name, e.callee.pos, inCoroutine, true)
        else visitExpr(e.callee, inCoroutine)
        e.args.forEach(a => visitExpr(a.value, inCoroutine))
        if (e.lambda) {
          const calleeName = e.callee.k === 'Ident' ? e.callee.name
            : e.callee.k === 'Member' ? e.callee.name : null
          const bodyInCoroutine = inCoroutine || (calleeName !== null && COROUTINE_BUILDERS.has(calleeName))
          visitBlockWithNames(e.lambda.body, bodyInCoroutine, [...e.lambda.params, 'it'])
        }
        break
      }
      case 'Binary': visitExpr(e.left, inCoroutine); visitExpr(e.right, inCoroutine); break
      case 'Range': visitExpr(e.from, inCoroutine); visitExpr(e.to, inCoroutine); break
      case 'Unary': visitExpr(e.operand, inCoroutine); break
      case 'LambdaExpr':
        visitBlockWithNames(e.lambda.body, inCoroutine, [...e.lambda.params, 'it'])
        break
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

  // Tên hàm vào scope gốc TRƯỚC khi duyệt bất kỳ thân nào: hàm gọi hàm khai
  // báo sau nó, và hàm gọi chính nó, đều hợp lệ trong Kotlin.
  program.funs.forEach(f => declare(f.name))

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
