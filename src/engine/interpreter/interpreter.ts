import type { Block, Expr, FunDecl, Program, Stmt } from '../ast/nodes'
import { CoroutineContext } from '../runtime/context'
import { toCause, type Scheduler } from '../runtime/scheduler'
import type { CoroutineBody, Suspension } from '../runtime/suspension'
import { Env } from './env'
import { KotlinThrow, UNIT, display, truthy, type KValue } from './values'

export type Eval<T> = Generator<Suspension, T, unknown>

/** Lệnh `return` được cài bằng exception nội bộ, không lẫn với exception Kotlin. */
class ReturnSignal { constructor(readonly value: KValue) {} }

export class Interpreter {
  readonly globals = new Env()
  private readonly funs = new Map<string, FunDecl>()

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
        env.declare(s.name, yield* this.evalExpr(s.init, env))
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
          throw new KotlinThrow(v.className, msg && msg.t === 'str' ? msg.v : '')
        }
        throw new KotlinThrow('Exception', display(v))
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
        for (const b of e.branches) {
          if (truthy(yield* this.evalExpr(b.cond, env))) return yield* this.evalBlock(b.block, env.child())
        }
        return e.elseBlock ? yield* this.evalBlock(e.elseBlock, env.child()) : UNIT
      }
      case 'Member': {
        const target = yield* this.evalExpr(e.target, env)
        if (target.t === 'obj') {
          const f = target.fields.get(e.name)
          if (f) return f
          return { t: 'obj', className: `${target.className}.${e.name}`, fields: new Map() }
        }
        return UNIT
      }
      case 'Call': return yield* this.evalCall(e, env)
    }
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

  protected *evalCall(e: Expr & { k: 'Call' }, env: Env): Eval<KValue> {
    const calleeName = e.callee.k === 'Ident'
      ? e.callee.name
      : e.callee.k === 'Member' ? e.callee.name : null

    // ---- điểm suspend ----
    if (calleeName === 'delay') {
      const ms = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : { t: 'num' as const, v: 0 }
      yield { s: 'delay', ms: ms.t === 'num' ? ms.v : 0 }
      return UNIT
    }
    if (calleeName === 'yield') { yield { s: 'yield' }; return UNIT }

    if (calleeName === 'join' || calleeName === 'await') {
      const target = e.callee.k === 'Member' ? yield* this.evalExpr(e.callee.target, env) : UNIT
      const jobId = target.t === 'obj' ? target.fields.get('__jobId') : undefined
      if (jobId && jobId.t === 'str') yield { s: calleeName === 'join' ? 'join' : 'await', jobId: jobId.v }
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
        if (calleeName === 'cancelAndJoin') yield { s: 'join', jobId: jobId.v }
      }
      return UNIT
    }

    // ---- coroutine builder ----
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
      try {
        // Thân scope chạy trong Env mang jobId của scope, nên launch bên trong
        // gắn đúng cha kể cả sau khi suspend/resume.
        const result = yield* this.evalBlock(lambda.body, env.child(job.id))
        // coroutineScope/supervisorScope/runBlocking chỉ trả về khi mọi child xong.
        yield { s: 'joinChildren', jobId: job.id }
        this.scheduler.completeInline(job)
        return result
      } catch (err) {
        // KHÔNG được gộp hai đường vào `finally { completeInline(job) }`.
        // completeInline không có đường thất bại, nên một exception thoát khỏi
        // thân scope sẽ báo scope HOÀN THÀNH THÀNH CÔNG: con của nó không ai
        // huỷ và chạy tiếp như mồ côi, và failure không bao giờ đi qua
        // reportFailure. Đúng thứ ngữ nghĩa mà công cụ này tồn tại để dạy.
        if (err instanceof KotlinThrow) this.scheduler.failInline(job, toCause(err))
        // ReturnSignal (lệnh `return`) là kết thúc BÌNH THƯỜNG của scope, không
        // phải failure — vẫn completeInline như đường thuận.
        else this.scheduler.completeInline(job)
        throw err
      }
    }

    if (calleeName === 'launch' || calleeName === 'async') {
      const lambda = e.lambda
      if (!lambda) return UNIT
      const ctx = yield* this.contextFromArgs(e, env)
      const body = lambda.body
      // Không alias `this` (vi phạm no-this-alias) — bind evalBlock thay vào đó.
      const evalBlock = this.evalBlock.bind(this)
      // Factory nhận Job vừa tạo, nên Env con mang đúng jobId của chính coroutine này.
      const job = this.scheduler.spawnChildOf(env.enclosingJobId, ctx, calleeName, created =>
        (function* (): CoroutineBody {
          yield* evalBlock(body, env.child(created.id))
          // Job của launch/async KHÔNG được Completed ngay khi thân nó chạy xong —
          // structured concurrency đòi mọi child (vd. launch lồng bên trong launch)
          // cũng phải xong trước. Thiếu bước này, Job cha coi như Completed trong
          // khi cháu vẫn Active, nên parent.cancel() gọi sau đó thấy job.isCompleted
          // và no-op — cancel không bao giờ lan tới cháu (lesson jobtree).
          yield { s: 'joinChildren', jobId: created.id }
        })())
      return {
        t: 'obj', className: calleeName === 'launch' ? 'Job' : 'Deferred',
        fields: new Map([['__jobId', { t: 'str', v: job.id } as KValue]]),
      }
    }

    // ---- factory context ----
    if (calleeName === 'SupervisorJob' || calleeName === 'Job') {
      return {
        t: 'obj', className: calleeName,
        fields: new Map([['__supervisor', { t: 'bool', v: calleeName === 'SupervisorJob' } as KValue]]),
      }
    }
    if (calleeName === 'CoroutineScope' || calleeName === 'MainScope') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return { t: 'obj', className: 'CoroutineScope', fields: new Map([['__ctx', arg]]) }
    }
    if (calleeName === 'CoroutineName') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return { t: 'obj', className: 'CoroutineName', fields: new Map([['name', arg]]) }
    }

    const name = e.callee.k === 'Ident' ? e.callee.name : null

    if (name === 'println') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      this.scheduler.println(display(arg), e.pos.line)
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
    return ctx
  }
}
