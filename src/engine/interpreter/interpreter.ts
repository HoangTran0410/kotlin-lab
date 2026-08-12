import type { Block, Expr, FunDecl, Program, Stmt } from '../ast/nodes'
import { CoroutineContext } from '../runtime/context'
import type { Job } from '../runtime/job'
import type { JobId } from '../trace/events'
import { toCause, type Scheduler } from '../runtime/scheduler'
import type { CoroutineBody, Suspension } from '../runtime/suspension'
import { Env } from './env'
import { KotlinThrow, UNIT, display, isKValue, truthy, type KValue } from './values'

export type Eval<T> = Generator<Suspension, T, unknown>

/** Lệnh `return` được cài bằng exception nội bộ, không lẫn với exception Kotlin. */
class ReturnSignal { constructor(readonly value: KValue) {} }

/** Vế phải có phải TRỰC TIẾP một lời gọi sinh ra node trên đồ thị không. */
function isDirectCoroutineCall(e: Expr): boolean {
  if (e.k !== 'Call') return false
  const ten = e.callee.k === 'Ident' ? e.callee.name
    : e.callee.k === 'Member' ? e.callee.name : null
  return ten === 'launch' || ten === 'async'
    || ten === 'CoroutineScope' || ten === 'MainScope'
}

export class Interpreter {
  readonly globals = new Env()
  private readonly funs = new Map<string, FunDecl>()
  /** Tên biến đang chờ gán cho coroutine sắp spawn. Xem case 'ValDecl'. */
  protected pendingVarName: string | undefined = undefined

  constructor(readonly scheduler: Scheduler, readonly program: Program) {
    program.funs.forEach(f => this.funs.set(f.name, f))
  }

  lookupFun(name: string): FunDecl | undefined { return this.funs.get(name) }

  *evalBlock(block: Block, env: Env): Eval<KValue> {
    let last: KValue = UNIT
    for (const s of block.stmts) last = yield* this.evalStmt(s, env)
    return last
  }

  *evalStmt(s: Stmt, env: Env): Eval<KValue> {
    switch (s.k) {
      case 'ValDecl': {
        // `val job = launch { }` -> node trên đồ thị mang tên `job`.
        //
        // Chỉ nhận khi vế phải LÀ TRỰC TIẾP một lời gọi launch/async. Kiểm tra
        // theo cú pháp chứ không phải "spawn kế tiếp là của tôi": nếu vế phải là
        // một hàm mà bên trong nó có launch, tên biến sẽ dán nhầm vào coroutine
        // bên trong hàm đó.
        const tenBien = isDirectCoroutineCall(s.init) ? s.name : undefined
        const truoc = this.pendingVarName
        this.pendingVarName = tenBien
        try {
          env.declare(s.name, yield* this.evalExpr(s.init, env))
        } finally {
          this.pendingVarName = truoc
        }
        return UNIT
      }
      case 'Assign': {
        const v = yield* this.evalExpr(s.value, env)
        if (s.target.k === 'Ident' && env.set(s.target.name, v)) return UNIT
        throw new KotlinThrow('IllegalStateException', 'Không gán được biến')
      }
      case 'ExprStmt': return yield* this.evalExpr(s.expr, env)
      case 'Throw': {
        const v = yield* this.evalExpr(s.expr, env)
        if (v.t === 'obj') {
          const msg = v.fields.get('message')
          throw new KotlinThrow(v.className, msg && msg.t === 'str' ? msg.v : '', s.pos.line)
        }
        throw new KotlinThrow('Exception', display(v), s.pos.line)
      }
      case 'Return': {
        throw new ReturnSignal(s.expr ? yield* this.evalExpr(s.expr, env) : UNIT)
      }
      case 'While': {
        let guard = 0
        while (truthy(yield* this.evalExpr(s.cond, env))) {
          if (++guard > 100_000) throw new KotlinThrow('IllegalStateException', 'Vòng lặp quá dài')
          yield* this.evalBlock(s.body, env.child())
        }
        return UNIT
      }
      case 'For': {
        const it = yield* this.evalExpr(s.iterable, env)
        if (it.t !== 'range') throw new KotlinThrow('IllegalArgumentException', 'for chỉ hỗ trợ khoảng a..b')
        for (let i = it.from; i <= it.to; i++) {
          const scope = env.child()
          scope.declare(s.name, { t: 'num', v: i })
          yield* this.evalBlock(s.body, scope)
        }
        return UNIT
      }
      case 'Try': {
        try {
          try {
            return yield* this.evalBlock(s.body, env.child())
          } catch (err) {
            if (!(err instanceof KotlinThrow)) throw err
            for (const c of s.catches) {
              if (c.type === 'Exception' || c.type === err.kotlinType
                  || (c.type === 'Throwable')) {
                // Phát TRƯỚC khi chạy thân catch: mọi println bên trong thân
                // phải nằm SAU câu "đã bắt được" trên trace, không phải trước.
                // `c.block.pos` là dấu `{` của đúng nhánh catch khớp — dòng mà
                // người học cần nhìn. `s.pos` là dòng của `try`, có thể cách
                // đó cả chục dòng và trỏ về chỗ chẳng có gì xảy ra.
                this.scheduler.exceptionCaught(err.kotlinType, c.block.pos.line)
                const scope = env.child()
                scope.declare(c.name, {
                  t: 'obj', className: err.kotlinType,
                  fields: new Map([['message', { t: 'str', v: err.kotlinMessage } as KValue]]),
                })
                return yield* this.evalBlock(c.block, scope)
              }
            }
            throw err
          }
        } finally {
          // finally chạy xuyên qua yield — đây là lý do dùng generator.
          if (s.finallyBlock) yield* this.evalBlock(s.finallyBlock, env.child())
        }
      }
    }
  }

  *evalExpr(e: Expr, env: Env): Eval<KValue> {
    switch (e.k) {
      case 'NumberLit': return { t: 'num', v: e.value }
      case 'BoolLit': return { t: 'bool', v: e.value }
      case 'NullLit': return { t: 'null' }
      case 'StringLit': {
        let out = ''
        for (const p of e.parts) {
          out += p.type === 'text' ? p.value : display(yield* this.evalExpr(p.expr, env))
        }
        return { t: 'str', v: out }
      }
      case 'Ident': {
        const v = env.get(e.name)
        if (v) return v
        // `isActive` trần (không receiver) trong thân coroutine đọc job của
        // scope BAO QUANH THEO TỪ VỰNG — env.enclosingJobId, KHÔNG phải
        // scheduler.currentJob. currentJob bị reset về null mỗi khi step()
        // kết thúc lượt chạy đồng bộ của nó (xem ghi chú trong env.ts), nên
        // dùng nó ở đây sẽ trỏ nhầm job ngay khi có coroutine khác xen vào.
        if (e.name === 'isActive' && !env.has('isActive')) {
          const j = env.enclosingJobId === null ? null : this.scheduler.jobById(env.enclosingJobId)
          return { t: 'bool', v: j ? j.isActive : true }
        }
        return { t: 'obj', className: e.name, fields: new Map() }
      }
      case 'Range': {
        const a = yield* this.evalExpr(e.from, env)
        const b = yield* this.evalExpr(e.to, env)
        if (a.t !== 'num' || b.t !== 'num') throw new KotlinThrow('IllegalArgumentException', 'Khoảng cần số')
        return { t: 'range', from: a.v, to: b.v }
      }
      case 'Unary': {
        const v = yield* this.evalExpr(e.operand, env)
        if (e.op === '-' && v.t === 'num') return { t: 'num', v: -v.v }
        if (e.op === '!') return { t: 'bool', v: !truthy(v) }
        return UNIT
      }
      case 'Binary': return yield* this.evalBinary(e, env)
      case 'LambdaExpr': return { t: 'lambda', lambda: e.lambda, env }
      case 'IfExpr': {
        if (truthy(yield* this.evalExpr(e.cond, env))) return yield* this.evalBlock(e.thenBlock, env.child())
        return e.elseBlock ? yield* this.evalBlock(e.elseBlock, env.child()) : UNIT
      }
      case 'WhenExpr': {
        // Có subject: so BẰNG với giá trị từng nhánh, cùng quy ước display()
        // mà evalBinary dùng cho '=='. Không subject: mỗi nhánh là một điều
        // kiện boolean (ngữ nghĩa cũ). Trước đây chỉ có đường thứ hai, nên
        // `when (x) { 1 -> ... }` luôn chọn nhánh đầu — mọi số đều truthy.
        const subject = e.subject ? yield* this.evalExpr(e.subject, env) : null
        for (const b of e.branches) {
          let matched: boolean
          if (b.cond === null) matched = true // else
          else if (subject === null) matched = truthy(yield* this.evalExpr(b.cond, env))
          else matched = display(yield* this.evalExpr(b.cond, env)) === display(subject)
          if (!matched) continue
          const scope = env.child()
          if (b.block) return yield* this.evalBlock(b.block, scope)
          if (b.expr) return yield* this.evalExpr(b.expr, scope)
          return UNIT
        }
        return UNIT
      }
      case 'Member': {
        const target = yield* this.evalExpr(e.target, env)
        if (target.t === 'obj') {
          const f = target.fields.get(e.name)
          if (f) return f
          // Job THẬT đứng sau __jobId, đọc TRƯỚC khi rơi xuống fallback dựng
          // object rác — `job.isActive`/`isCancelled`/`isCompleted` là lõi của
          // lesson suspend: cách duy nhất thấy coroutine SUSPENDED nhưng Job
          // vẫn ACTIVE bằng code.
          const job = this.jobOf(target)
          if (job) {
            if (e.name === 'isActive') return { t: 'bool', v: job.isActive }
            if (e.name === 'isCancelled') return { t: 'bool', v: job.isCancelled }
            if (e.name === 'isCompleted') return { t: 'bool', v: job.isCompleted }
          }
          return { t: 'obj', className: `${target.className}.${e.name}`, fields: new Map() }
        }
        return UNIT
      }
      case 'Call': return yield* this.evalCall(e, env)
    }
  }

  /** Job thật đằng sau một KValue object mang `__jobId`, hoặc null. */
  private jobOf(v: KValue): Job | null {
    if (v.t !== 'obj') return null
    const id = v.fields.get('__jobId')
    return id && id.t === 'str' ? this.scheduler.jobById(id.v) : null
  }

  private *evalBinary(e: Expr & { k: 'Binary' }, env: Env): Eval<KValue> {
    if (e.op === '&&') {
      return truthy(yield* this.evalExpr(e.left, env))
        ? { t: 'bool', v: truthy(yield* this.evalExpr(e.right, env)) }
        : { t: 'bool', v: false }
    }
    if (e.op === '||') {
      return truthy(yield* this.evalExpr(e.left, env))
        ? { t: 'bool', v: true }
        : { t: 'bool', v: truthy(yield* this.evalExpr(e.right, env)) }
    }
    const l = yield* this.evalExpr(e.left, env)
    const r = yield* this.evalExpr(e.right, env)
    if (e.op === '+' && (l.t === 'str' || r.t === 'str')) {
      return { t: 'str', v: display(l) + display(r) }
    }
    if (e.op === '+' && l.t === 'obj' && r.t === 'obj') {
      // KHÔNG trộn fields và nối className. Cách đó tạo ra className rác kiểu
      // 'Dispatchers.IO+CoroutineName', rồi applyCtxValue nhận dạng sai hết:
      // đã đo được dispatcher thành "IO+CoroutineName" còn name bị mất trắng.
      // Giữ danh sách phần tử theo đúng thứ tự để applyCtxValue duyệt lần lượt.
      const items: KValue[] = []
      const flatten = (v: KValue): void => {
        if (v.t === 'obj' && v.className === '__CtxPlus') {
          for (let i = 0; ; i++) {
            const it = v.fields.get(String(i))
            if (!it) break
            flatten(it)
          }
        } else items.push(v)
      }
      flatten(l); flatten(r)
      const fields = new Map<string, KValue>()
      items.forEach((it, i) => fields.set(String(i), it))
      return { t: 'obj', className: '__CtxPlus', fields }
    }
    if (l.t === 'num' && r.t === 'num') {
      switch (e.op) {
        case '+': return { t: 'num', v: l.v + r.v }
        case '-': return { t: 'num', v: l.v - r.v }
        case '*': return { t: 'num', v: l.v * r.v }
        case '/': return { t: 'num', v: Math.trunc(l.v / r.v) }
        case '%': return { t: 'num', v: l.v % r.v }
        case '<': return { t: 'bool', v: l.v < r.v }
        case '>': return { t: 'bool', v: l.v > r.v }
        case '<=': return { t: 'bool', v: l.v <= r.v }
        case '>=': return { t: 'bool', v: l.v >= r.v }
      }
    }
    if (e.op === '==' || e.op === '===') return { t: 'bool', v: display(l) === display(r) }
    if (e.op === '!=' || e.op === '!==') return { t: 'bool', v: display(l) !== display(r) }
    return UNIT
  }

  /**
   * Điều phối một lời gọi qua BA nhóm handler, theo đúng thứ tự ưu tiên cũ.
   * Mỗi handler trả `undefined` nghĩa là "không phải của tôi" nên lời gọi đi
   * tiếp xuống nhóm sau; trả KValue — kể cả UNIT — nghĩa là đã xử lý xong.
   *
   * Thứ tự là MỘT PHẦN CỦA NGỮ NGHĨA, không được đảo. `Job()` phải rơi vào
   * nhóm factory context; nếu nó xuống tới quy tắc "tên viết hoa -> dựng
   * object" ở cuối thì cờ __supervisor biến mất không một tiếng động.
   */
  protected *evalCall(e: Expr & { k: 'Call' }, env: Env): Eval<KValue> {
    // Một tên chung cho cả `foo()` lẫn `x.foo()`. Receiver do từng handler tự
    // đọc khi cần (join/await/cancel, và scopeReceiver của launch/async), nên
    // đừng suy ra "không có receiver" từ biến này — nhóm cuối dùng `name`.
    const calleeName = e.callee.k === 'Ident'
      ? e.callee.name
      : e.callee.k === 'Member' ? e.callee.name : null

    const suspension = yield* this.trySuspensionPoint(calleeName, e, env)
    if (suspension !== undefined) return suspension

    const builder = yield* this.tryBuilder(calleeName, e, env)
    if (builder !== undefined) return builder

    const ctxValue = yield* this.tryContextFactory(calleeName, e, env)
    if (ctxValue !== undefined) return ctxValue

    // `x.toString()` — một trong những lời gọi phổ biến nhất của Kotlin, và
    // trước đây nó rơi xuống tận nhánh cuối rồi trả Unit im lặng:
    // `println(i.toString())` in ra "kotlin.Unit". Dùng chính `display` mà phép
    // `+` giữa chuỗi và số đang dùng, nên `"" + i` và `i.toString()` không thể
    // cho ra hai kết quả khác nhau.
    if (calleeName === 'toString' && e.callee.k === 'Member') {
      return { t: 'str', v: display(yield* this.evalExpr(e.callee.target, env)) }
    }

    const name = e.callee.k === 'Ident' ? e.callee.name : null

    // error(msg) nằm trong subset §4.1 và 3 kịch bản gốc dùng nó. Trước đây
    // rơi xuống nhánh cuối và trả Unit im lặng: println("before"); error("boom");
    // println("after") in ra CẢ HAI dòng — sai không tiếng động. Kotlin thật:
    // error(msg) = throw IllegalStateException(msg.toString()), dừng luồng
    // ngay tại chỗ gọi. Đặt TRƯỚC println để không lọt xuống fallback.
    if (name === 'error') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      throw new KotlinThrow('IllegalStateException', display(arg), e.pos.line)
    }

    // ensureActive() là idiom chuẩn của vòng lặp huỷ được (cooperative
    // cancellation): ném ngay tại chỗ gọi nếu job của scope bao quanh không
    // còn Active, thay vì phải chờ tới điểm suspend (delay/yield) tiếp theo.
    if (name === 'ensureActive') {
      const j = env.enclosingJobId === null ? null : this.scheduler.jobById(env.enclosingJobId)
      if (j && !j.isActive) {
        throw new KotlinThrow('CancellationException', 'Job was cancelled', e.pos.line)
      }
      return UNIT
    }

    if (name === 'println') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      this.scheduler.println(display(arg), e.pos.line)
      return UNIT
    }

    // repeat(n) { } nằm trong subset §4.1 và không có trong danh mục hoãn nào.
    // Không cài thì nó rơi xuống nhánh cuối và trả Unit im lặng: không chạy lần
    // nào, cũng không báo gì.
    if (name === 'repeat') {
      const lambda = e.lambda
      const n = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      if (!lambda || n.t !== 'num') return UNIT
      let guard = 0
      for (let i = 0; i < n.v; i++) {
        if (++guard > 100_000) throw new KotlinThrow('IllegalStateException', 'Vòng lặp quá dài')
        const scope = env.child()
        // Lambda một tham số: dùng tên tự đặt nếu có, không thì `it` như Kotlin.
        scope.declare(lambda.params[0] ?? 'it', { t: 'num', v: i })
        // yield* chứ không phải vòng lặp thường: điểm suspend bên trong repeat
        // phải nhường quyền được ra ngoài như mọi chỗ khác.
        yield* this.evalBlock(lambda.body, scope)
      }
      return UNIT
    }

    if (name && /^[A-Z]/.test(name)) {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return {
        t: 'obj', className: name,
        fields: new Map([['message', arg.t === 'str' ? arg : { t: 'str', v: '' } as KValue]]),
      }
    }

    if (name) {
      const fn = this.funs.get(name)
      if (fn) return yield* this.callFun(fn, e.args, env)
    }

    return UNIT
  }

  /**
   * delay/yield/join/await/cancel/cancelAndJoin — những lời gọi NHƯỜNG QUYỀN
   * điều khiển về scheduler. Phải xét TRƯỚC mọi nhóm khác: `cancel` và
   * `join` là gọi kiểu thành viên trên Job, nếu để chúng rơi xuống dưới thì
   * nhánh nào bắt được trước cũng nuốt mất điểm suspend.
   */
  protected *trySuspensionPoint(
    calleeName: string | null, e: Expr & { k: 'Call' }, env: Env,
  ): Eval<KValue | undefined> {
    if (calleeName === 'delay') {
      const ms = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : { t: 'num' as const, v: 0 }
      yield { s: 'delay', ms: ms.t === 'num' ? ms.v : 0, line: e.pos.line }
      return UNIT
    }
    if (calleeName === 'yield') { yield { s: 'yield', line: e.pos.line }; return UNIT }

    if (calleeName === 'join' || calleeName === 'await') {
      const target = e.callee.k === 'Member' ? yield* this.evalExpr(e.callee.target, env) : UNIT
      const jobId = target.t === 'obj' ? target.fields.get('__jobId') : undefined
      if (jobId && jobId.t === 'str') {
        const resumed = yield { s: calleeName === 'join' ? 'join' : 'await', jobId: jobId.v, line: e.pos.line }
        // Chỉ await mới ĐỌC kết quả — đó là toàn bộ khác biệt giữa hai lời gọi,
        // và là nội dung bài học launchasync. Scheduler ném thẳng vào generator
        // này nếu Deferred đã fail, nên tới được dòng dưới nghĩa là nó thành công.
        if (calleeName === 'await') return isKValue(resumed) ? resumed : UNIT
      }
      return UNIT
    }

    if (calleeName === 'cancel' || calleeName === 'cancelAndJoin') {
      const target = e.callee.k === 'Member' ? yield* this.evalExpr(e.callee.target, env) : UNIT
      const jobId = target.t === 'obj' ? target.fields.get('__jobId') : undefined
      if (jobId && jobId.t === 'str') {
        this.scheduler.cancelById(jobId.v, {
          exType: 'CancellationException', message: 'Job was cancelled', isCancellation: true,
        })
        // cancelAndJoin từng được nối thẳng vào nhánh này và im lặng KHÔNG join,
        // nên nó cho ra đúng thứ tự sai mà người học dùng nó để tránh: lệnh sau
        // nó chạy trước khi finally của coroutine bị huỷ kịp chạy.
        if (calleeName === 'cancelAndJoin') yield { s: 'join', jobId: jobId.v, line: e.pos.line }
      }
      return UNIT
    }
    return undefined
  }

  /**
   * runBlocking/coroutineScope/supervisorScope/withContext (chạy TẠI CHỖ) và
   * launch/async (tạo coroutine con chạy sau).
   */
  protected *tryBuilder(
    calleeName: string | null, e: Expr & { k: 'Call' }, env: Env,
  ): Eval<KValue | undefined> {
    if (calleeName === 'runBlocking' || calleeName === 'coroutineScope'
        || calleeName === 'supervisorScope' || calleeName === 'withContext') {
      const lambda = e.lambda
      if (!lambda) return UNIT
      const isSupervisor = calleeName === 'supervisorScope'
      const ctx = yield* this.contextFromArgs(e, env)
      const job = this.scheduler.spawnInline(
        calleeName === 'runBlocking' ? 'runBlocking'
          : calleeName === 'withContext' ? 'withContext'
          : calleeName === 'coroutineScope' ? 'coroutineScope' : 'supervisorScope',
        env.enclosingJobId, isSupervisor, ctx,
      )
      // `withContext(Dispatchers.X)` là builder DUY NHẤT đổi được dispatcher
      // giữa chừng. Ba builder kia không nhận dispatcher (coroutineScope /
      // supervisorScope không có đối số; runBlocking lồng nhau nằm ngoài subset).
      //
      // `dispatcherCũ` phải là dispatcher THẬT của task đang chạy, không phải
      // của job cha theo cấu trúc — hai cái này khác nhau khi withContext lồng
      // nhau. `dispatcherMới` đọc từ ctx ĐÃ MERGE của chính job vừa tạo, không
      // đọc `ctx` dựng từ đối số: `withContext(CoroutineName("x"))` không đặt
      // dispatcher nào, và ctx-đối-số trả về 'Default' mặc định — so với nó thì
      // mọi withContext-chỉ-đổi-tên đều hoá ra "đổi dispatcher".
      const oldDispatcher = this.scheduler.currentDispatcher()
      const newDispatcher = this.scheduler.dispatcherOf(job.id)
      const needsSwitch = calleeName === 'withContext' && newDispatcher !== oldDispatcher
      if (needsSwitch) {
        yield { s: 'switchContext', jobId: job.id, dispatcher: newDispatcher, line: e.pos.line }
      }
      try {
        // Câu lệnh ĐẦU TIÊN trong try, và cú push DUY NHẤT. Đặt nó ở
        // `spawnInline` (tức trước `yield switchContext` phía trên) thì có một
        // cửa sổ push-rồi-mà-chưa-được-finally-canh: huỷ rơi đúng vào điểm đổi
        // dispatcher sẽ ném vào generator TRƯỚC try, pop không bao giờ chạy, và
        // `finally { println(...) }` của người dùng mang id của scope withContext
        // chưa từng chạy thân. Đã đo trước khi sửa; ca canh nằm ở
        // dispatch.test.ts "huỷ rơi đúng điểm đổi dispatcher".
        this.scheduler.enterInline(job)
        return yield* this.runInlineBody(lambda.body, job, env)
      } finally {
        // `finally` chứ không phải hai lời gọi ở hai đường: scope inline có BA
        // đường thoát (thân xong, thân ném, con của scope fail) và đường thứ ba
        // không đi qua completeInline lẫn failInline. Chỉ `finally` mới ghép
        // được đúng MỘT pop cho mỗi push.
        //
        // Ba điểm suspend BÊN TRONG try mà huỷ có thể rơi vào — thân scope,
        // `joinChildren`, và điểm đổi dispatcher lượt về — nay đều đi qua đây
        // thật. Trước Task 20 thì KHÔNG: câu này từng nói quá, chỉ điểm đổi
        // dispatcher là đúng.
        //   - thân scope: `unwindCancelled` chỉ xét `task.job`, mà thân một
        //     scope inline chạy trong task CHA (job cha không bị huỷ), nên tín
        //     hiệu huỷ không bao giờ tới nơi. Nay xét `jobChiPhối` — đỉnh ngăn
        //     xếp inline của task.
        //   - `joinChildren`: tín hiệu có tới, nhưng `runInlineBody` bắt được
        //     rồi `yield joinChildren` lần nữa, nên `body.throw()` TRẢ VỀ thay
        //     vì ném; scheduler cũ vứt cái IteratorResult ấy đi và bỏ rơi
        //     generator giữa chừng — `finally` không bao giờ chạy. Nay scheduler
        //     đưa nó trở lại đường chạy bình thường (xem `unwindCancelled` và
        //     `Task.unwinding`).
        // Ca canh cho cả hai nằm ở `inline-cancel.test.ts`.
        this.scheduler.exitInline(job)
        // Đổi dispatcher VỀ, kể cả trên đường ném — đã đối chiếu Kotlin 2.1.20:
        // sau `try { withContext(Dispatchers.IO) { throw ... } } catch`, cả catch
        // lẫn lệnh sau đó đều chạy trên thread `main`. `yield` trong `finally` là
        // hợp lệ với generator JS và là cách duy nhất bảo đảm điều đó — cùng lý
        // do mà `finally` của Kotlin chạy được khi bị cancel (spec §2.3).
        //
        // Đứng SAU exitInline: lúc này job withContext đã Completed và đã rời
        // ngăn xếp, nên DISPATCH lượt về phải đứng tên job GỌI (job đang thật sự
        // được resume trên dispatcher cũ), không phải tên một scope đã chết.
        if (needsSwitch) {
          yield {
            s: 'switchContext', jobId: env.enclosingJobId ?? job.id, dispatcher: oldDispatcher,
          }
        }
      }
    }

    if (calleeName === 'launch' || calleeName === 'async') {
      const lambda = e.lambda
      if (!lambda) return UNIT
      // Lấy VÀ XOÁ ngay, TRƯỚC khi đánh giá đối số: `launch(f()) { }` mà `f()`
      // bên trong lại spawn thì coroutine của f sẽ cướp mất tên biến.
      const varName = this.pendingVarName
      this.pendingVarName = undefined
      const argCtx = yield* this.contextFromArgs(e, env)
      // Receiver quyết định CHA và context nền. Bỏ qua nó thì
      // GlobalScope.launch { } gắn vào job bao quanh y hệt launch thường —
      // "GlobalScope thoát khỏi cây job" là bài học công cụ này thay thế, nên
      // hai thứ đó bắt buộc phải phân biệt được.
      const recv = yield* this.scopeReceiver(e, env)
      const parentJobId = recv ? recv.parentJobId : env.enclosingJobId
      const ctx = recv ? recv.ctx.plus(argCtx) : argCtx
      const body = lambda.body
      // Không alias `this` (vi phạm no-this-alias) — bind evalBlock thay vào đó.
      const evalBlock = this.evalBlock.bind(this)
      // Factory nhận Job vừa tạo, nên Env con mang đúng jobId của chính coroutine này.
      const job = this.scheduler.spawnChildOf(parentJobId, ctx, calleeName, varName, created =>
        (function* (): CoroutineBody {
          const v = yield* evalBlock(body, env.child(created.id))
          // Job của launch/async KHÔNG được Completed ngay khi thân nó chạy xong —
          // structured concurrency đòi mọi child (vd. launch lồng bên trong launch)
          // cũng phải xong trước. Thiếu bước này, Job cha coi như Completed trong
          // khi cháu vẫn Active, nên parent.cancel() gọi sau đó thấy job.isCompleted
          // và no-op — cancel không bao giờ lan tới cháu (lesson jobtree).
          yield { s: 'joinChildren', jobId: created.id }
          // Trả về SAU joinChildren: giá trị đã có từ trước, nhưng Deferred chỉ
          // được coi là xong khi mọi con của nó cũng xong (structured concurrency).
          // Với launch thì không ai đọc — join() chỉ chờ.
          return v
        })(), e.pos.line, body.stmts[0]?.pos.line)
      return {
        t: 'obj', className: calleeName === 'launch' ? 'Job' : 'Deferred',
        fields: new Map([['__jobId', { t: 'str', v: job.id } as KValue]]),
      }
    }
    return undefined
  }

  /**
   * Thân của một scope inline đã được `spawnInline` tạo job: chạy thân, chờ con,
   * rồi đóng job theo đúng đường thuận/nghịch. Tách khỏi `tryBuilder` để phần
   * đổi dispatcher (yield vào/ra) bọc được toàn bộ khối này trong một try/finally
   * mà không phải thụt lề lại toàn bộ logic vốn có.
   */
  private *runInlineBody(body: Block, job: Job, env: Env): Eval<KValue> {
    let result: KValue
    try {
      // Thân scope chạy trong Env mang jobId của scope, nên launch bên trong
      // gắn đúng cha kể cả sau khi suspend/resume.
      result = yield* this.evalBlock(body, env.child(job.id))
      // coroutineScope/supervisorScope/runBlocking chỉ trả về khi mọi child xong.
      yield { s: 'joinChildren', jobId: job.id }
    } catch (err) {
      // KHÔNG được gộp hai đường vào `finally { completeInline(job) }`.
      // completeInline không có đường thất bại, nên một exception thoát khỏi
      // thân scope sẽ báo scope HOÀN THÀNH THÀNH CÔNG: con của nó không ai
      // huỷ và chạy tiếp như mồ côi, và failure không bao giờ đi qua
      // reportFailure. Đúng thứ ngữ nghĩa mà công cụ này tồn tại để dạy.
      if (err instanceof KotlinThrow) {
        this.scheduler.failInline(job, toCause(err))
        // Chờ con unwind XONG rồi mới ném ra ngoài. failInline vừa huỷ chúng,
        // nhưng huỷ chỉ lật trạng thái Job — khối `finally` trong code Kotlin
        // chỉ chạy khi scheduler ném vào generator ở vòng lặp sau. Bỏ bước
        // này thì catch của người gọi chạy TRƯỚC finally của con, ngược hẳn
        // Kotlin: cùng lỗi R1, chỉ khác đường đi tới (thân scope ném, thay vì
        // con của scope fail).
        yield { s: 'joinChildren', jobId: job.id }
        // Người gọi phải thấy FAILURE CỦA CHÍNH SCOPE NÀY, không phải thứ vừa
        // bay qua thân nó — cùng luật với đường thuận ở cuối hàm, chỉ khác lối
        // tới. Hai cái lệch nhau khi tín hiệu huỷ đi vào từ NGOÀI thân: với
        // `coroutineScope { launch { throw boom }; withContext(IO) { delay() } }`,
        // job withContext bị cancelJob kéo theo nên nhận CancellationException
        // (nó không `failure`), và nếu cứ ném lại `err` thì cái
        // CancellationException ấy chui thẳng qua khung của coroutineScope ra
        // tới người gọi — `catch (e: RuntimeException)` không khớp và "boom"
        // biến mất. Đã đối chiếu Kotlin thật: người gọi in "caught: boom".
        const failure = job.failure
        if (failure) throw new KotlinThrow(failure.exType, failure.message)
      } else {
        // ReturnSignal (lệnh `return`) là kết thúc BÌNH THƯỜNG của scope,
        // không phải failure — vẫn completeInline như đường thuận.
        this.scheduler.completeInline(job)
      }
      throw err
    }
    // Con fail => scope NÉM LẠI ĐÚNG TẠI ĐÂY, tức trong khung của người gọi.
    //
    // Trước đây việc ném lại xảy ra gián tiếp: failure của con leo lên đánh
    // dấu job bao ngoài là Cancelled, rồi unwindCancelled ném vào generator
    // của nó. Cách đó cho ra output đúng nhưng SAI hai chỗ — trace nói
    // runBlocking đã chết dù người học bắt được exception (R2), và tổ tiên bị
    // ném vào trước khi con cháu kịp chạy finally (R1). Ném ở đây thì cả hai
    // tự đúng: joinChildren ở trên đã bảo đảm mọi con unwind xong.
    //
    // `failure` chứ không phải `cause`: chỉ job THẬT SỰ fail mới ném lại.
    // supervisorScope chặn failure của con ngay tại ranh giới nên `failure`
    // của nó là null — đúng như Kotlin, caller không thấy gì cả.
    const failure = job.failure
    if (failure) throw new KotlinThrow(failure.exType, failure.message)
    this.scheduler.completeInline(job)
    return result
  }

  /**
   * SupervisorJob/Job/CoroutineScope/MainScope/CoroutineName — dựng giá trị
   * CoroutineContext, không chạy gì và không suspend.
   */
  protected *tryContextFactory(
    calleeName: string | null, e: Expr & { k: 'Call' }, env: Env,
  ): Eval<KValue | undefined> {
    if (calleeName === 'SupervisorJob' || calleeName === 'Job') {
      return {
        t: 'obj', className: calleeName,
        fields: new Map([['__supervisor', { t: 'bool', v: calleeName === 'SupervisorJob' } as KValue]]),
      }
    }
    if (calleeName === 'CoroutineScope' || calleeName === 'MainScope') {
      // MainScope() = SupervisorJob() + Dispatchers.Main (kotlinx: `ContextScope`).
      // Cả HAI element đều phải có mặt. Thiếu dispatcher thì nó im lặng thành
      // Default; thiếu SupervisorJob thì Job gốc dựng dưới đây là Job THƯỜNG, và
      // pattern Android kinh điển nhất lại dạy ngược — một con fail giết cả scope.
      const arg = calleeName === 'MainScope'
        ? mainScopeCtxValue()
        : e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      // Job GỐC có thật trong cây. Không có nó thì `scope.launch` là job mồ côi:
      // cờ SupervisorJob() rơi mất, `scope.cancel()` không có gì để huỷ, và
      // "sibling vẫn sống" trở thành đúng-vì-lý-do-sai (hai coroutine chẳng có
      // quan hệ nào) thay vì vì supervisor chặn được failure.
      //
      // Dựng cho MỌI CoroutineScope(ctx), kể cả khi ctx không có Job: kotlinx
      // làm đúng thế — `CoroutineScope(ctx) = ContextScope(if (ctx[Job] != null)
      // ctx else ctx + Job())`. Đã đối chiếu Kotlin thật:
      // `CoroutineScope(Dispatchers.Default).coroutineContext[Job]` là JobImpl{Active}.
      const ctx = this.applyCtxValue(CoroutineContext.empty(), arg)
      const varName = this.pendingVarName
      this.pendingVarName = undefined
      const root = this.scheduler.spawnScopeRoot(ctx, ctx.isSupervisor, varName)
      return {
        t: 'obj', className: 'CoroutineScope',
        fields: new Map<string, KValue>([
          ['__ctx', arg],
          ['__jobId', { t: 'str', v: root.id }],
        ]),
      }
    }
    if (calleeName === 'CoroutineName') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return { t: 'obj', className: 'CoroutineName', fields: new Map([['name', arg]]) }
    }
    return undefined
  }
  *callFun(fn: FunDecl, args: readonly { name: string | null; value: Expr }[], env: Env): Eval<KValue> {
    // Thân hàm không thấy biến cục bộ của caller, NHƯNG kế thừa coroutine scope
    // bao quanh — nhờ vậy launch bên trong một suspend fun gắn đúng cha.
    const scope = this.globals.child(env.enclosingJobId)
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i]!
      const byName = args.find(a => a.name === p.name)
      const positional = args[i] && args[i]!.name === null ? args[i]! : undefined
      const argExpr = byName?.value ?? positional?.value ?? p.defaultValue
      scope.declare(p.name, argExpr ? yield* this.evalExpr(argExpr, env) : UNIT)
    }
    try {
      if (fn.body) return yield* this.evalBlock(fn.body, scope)
      if (fn.exprBody) return yield* this.evalExpr(fn.exprBody, scope)
      return UNIT
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value
      throw err
    }
  }

  /**
   * Receiver của `x.launch { }` / `x.async { }`.
   *
   * Trả null nghĩa là "không nhận ra receiver nào đặc biệt, dùng scope bao
   * quanh về mặt từ vựng" — đó là đường của `this.launch`, `scope.launch` với
   * scope là CoroutineScope được truyền vào một suspend fun, và của mọi lời gọi
   * không có receiver.
   *
   * GlobalScope và CoroutineScope(ctx) đều KHÔNG treo dưới coroutine bao quanh —
   * đó là điều làm chúng thoát khỏi structured concurrency của nơi gọi. Nhưng
   * chúng KHÁC nhau ở chỗ ngay bên dưới, và sự khác biệt đó chính là bài học:
   *   - `CoroutineScope(ctx)` mang một Job GỐC có thật (`__jobId`), nên con của
   *     nó có cha, chịu `scope.cancel()`, và có ranh giới supervisor để chặn.
   *   - `GlobalScope` có context RỖNG, không Job nào cả, nên con của nó thật sự
   *     mồ côi: parentJobId = null. Đây không phải thiếu sót cần "thống nhất".
   */
  protected *scopeReceiver(
    e: Expr & { k: 'Call' }, env: Env,
  ): Eval<{ parentJobId: JobId | null; ctx: CoroutineContext } | null> {
    if (e.callee.k !== 'Member') return null
    const target = yield* this.evalExpr(e.callee.target, env)
    if (target.t !== 'obj') return null
    if (target.className === 'GlobalScope') {
      return { parentJobId: null, ctx: CoroutineContext.empty() }
    }
    if (target.className === 'CoroutineScope') {
      const raw = target.fields.get('__ctx')
      const ctx = raw ? this.applyCtxValue(CoroutineContext.empty(), raw) : CoroutineContext.empty()
      const id = target.fields.get('__jobId')
      return { parentJobId: id && id.t === 'str' ? id.v : null, ctx }
    }
    return null
  }

  /**
   * Dựng CoroutineContext từ đối số của builder.
   * Nhận Dispatchers.X, CoroutineName(...), SupervisorJob(), và chuỗi cộng bằng '+'.
   */
  protected *contextFromArgs(e: Expr & { k: 'Call' }, env: Env): Eval<CoroutineContext> {
    let ctx = CoroutineContext.empty()
    for (const a of e.args) {
      const v = yield* this.evalExpr(a.value, env)
      ctx = this.applyCtxValue(ctx, v)
    }
    return ctx
  }

  protected applyCtxValue(ctx: CoroutineContext, v: KValue): CoroutineContext {
    if (v.t !== 'obj') return ctx
    if (v.className === '__CtxPlus') {
      let out = ctx
      for (let i = 0; ; i++) {
        const it = v.fields.get(String(i))
        if (!it) break
        out = this.applyCtxValue(out, it)
      }
      return out
    }
    if (v.className.startsWith('Dispatchers.')) {
      return ctx.withDispatcher(v.className.slice('Dispatchers.'.length))
    }
    if (v.className === 'CoroutineName') {
      const n = v.fields.get('name')
      return n && n.t === 'str' ? ctx.withName(n.v) : ctx
    }
    if (v.className === 'CoroutineExceptionHandler') return ctx.withHandler('CEH')
    // Element Job của context. Trước Task 5, cả hai rơi thẳng xuống `return ctx`
    // và cờ supervisor bị đánh rơi ngay ở bước dựng context: mọi
    // `CoroutineScope(SupervisorJob())` chạy y hệt `CoroutineScope(Job())`.
    // `Job()` phải ghi ĐÈ thành false, không phải "không nói gì" — trong
    // `SupervisorJob() + Job()` thì element phải là element bên phải.
    if (v.className === 'SupervisorJob') return ctx.withSupervisor(true)
    if (v.className === 'Job') return ctx.withSupervisor(false)
    return ctx
  }
}

/**
 * `SupervisorJob() + Dispatchers.Main` dưới dạng KValue, đúng hình dạng mà
 * `evalBinary` sinh ra cho phép `+` giữa hai element context — nên nó đi qua
 * `applyCtxValue` bằng chính con đường mà code người học viết tay đi qua.
 */
function mainScopeCtxValue(): KValue {
  const items: KValue[] = [
    {
      t: 'obj', className: 'SupervisorJob',
      fields: new Map<string, KValue>([['__supervisor', { t: 'bool', v: true }]]),
    },
    { t: 'obj', className: 'Dispatchers.Main', fields: new Map<string, KValue>() },
  ]
  const fields = new Map<string, KValue>()
  items.forEach((it, i) => fields.set(String(i), it))
  return { t: 'obj', className: '__CtxPlus', fields }
}
