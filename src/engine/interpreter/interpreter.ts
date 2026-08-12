import type { Block, Expr, FunDecl, Program, Stmt } from '../ast/nodes'
import { CoroutineContext } from '../runtime/context'
import type { Job } from '../runtime/job'
import type { JobId } from '../trace/events'
import { toCause, type Scheduler } from '../runtime/scheduler'
import type { CoroutineBody, Suspension } from '../runtime/suspension'
import { Env } from './env'
import { KotlinThrow, UNIT, display, isKValue, truthy, type KValue } from './values'

export type Eval<T> = Generator<Suspension, T, unknown>

/** The `return` statement is implemented with an internal exception, not to be confused with a Kotlin exception. */
class ReturnSignal { constructor(readonly value: KValue) {} }

/** Is the right-hand side DIRECTLY a call that spawns a node on the graph? */
function isDirectCoroutineCall(e: Expr): boolean {
  if (e.k !== 'Call') return false
  const calleeName = e.callee.k === 'Ident' ? e.callee.name
    : e.callee.k === 'Member' ? e.callee.name : null
  return calleeName === 'launch' || calleeName === 'async'
    || calleeName === 'CoroutineScope' || calleeName === 'MainScope'
}

export class Interpreter {
  readonly globals = new Env()
  private readonly funs = new Map<string, FunDecl>()
  /** Variable name waiting to be assigned to the coroutine about to spawn. See case 'ValDecl'. */
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
        // `val job = launch { }` -> a node on the graph named `job`.
        //
        // Only accepted when the right-hand side IS DIRECTLY a launch/async
        // call. Checked syntactically rather than "the next spawn is mine": if
        // the right-hand side is a function that itself contains a launch
        // inside, the variable name would get pinned to the wrong coroutine —
        // the one inside that function.
        const varName = isDirectCoroutineCall(s.init) ? s.name : undefined
        const previous = this.pendingVarName
        this.pendingVarName = varName
        try {
          env.declare(s.name, yield* this.evalExpr(s.init, env))
        } finally {
          this.pendingVarName = previous
        }
        return UNIT
      }
      case 'Assign': {
        const v = yield* this.evalExpr(s.value, env)
        if (s.target.k === 'Ident' && env.set(s.target.name, v)) return UNIT
        throw new KotlinThrow('IllegalStateException', 'Could not assign variable')
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
          if (++guard > 100_000) throw new KotlinThrow('IllegalStateException', 'Loop ran too long')
          yield* this.evalBlock(s.body, env.child())
        }
        return UNIT
      }
      case 'For': {
        const it = yield* this.evalExpr(s.iterable, env)
        if (it.t !== 'range') throw new KotlinThrow('IllegalArgumentException', 'for only supports a range a..b')
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
                // Emit BEFORE running the catch body: any println inside the
                // body must appear AFTER the "caught" line on the trace, not
                // before. `c.block.pos` is the `{` of the matching catch
                // branch — the line the learner needs to see. `s.pos` is the
                // line of `try`, which can be a dozen lines away and points at
                // nothing that actually happened.
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
          // finally runs across a yield — this is the reason this uses a generator.
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
        // A bare `isActive` (no receiver) inside a coroutine body reads the
        // job of the LEXICALLY enclosing scope — env.enclosingJobId, NOT
        // scheduler.currentJob. currentJob gets reset to null every time
        // step() finishes its synchronous run (see the note in env.ts), so
        // using it here would point at the wrong job the moment another
        // coroutine interleaves.
        if (e.name === 'isActive' && !env.has('isActive')) {
          const j = env.enclosingJobId === null ? null : this.scheduler.jobById(env.enclosingJobId)
          return { t: 'bool', v: j ? j.isActive : true }
        }
        return { t: 'obj', className: e.name, fields: new Map() }
      }
      case 'Range': {
        const a = yield* this.evalExpr(e.from, env)
        const b = yield* this.evalExpr(e.to, env)
        if (a.t !== 'num' || b.t !== 'num') throw new KotlinThrow('IllegalArgumentException', 'A range needs numbers')
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
        // With a subject: compares for EQUALITY against each branch's value,
        // using the same display() convention that evalBinary uses for '=='.
        // Without a subject: each branch is a boolean condition (the old
        // semantics). Previously only the second path existed, so
        // `when (x) { 1 -> ... }` always picked the first branch — every
        // number is truthy.
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
          // The REAL Job sits behind __jobId — read it BEFORE falling through
          // to the garbage-object fallback. `job.isActive`/`isCancelled`/
          // `isCompleted` are the core of the suspend lesson: the only way to
          // see a coroutine that is SUSPENDED while its Job is still ACTIVE,
          // through code.
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

  /** The real Job behind a KValue object carrying `__jobId`, or null. */
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
      // Do NOT merge fields and concatenate the className. That produces a
      // garbage className like 'Dispatchers.IO+CoroutineName', and then
      // applyCtxValue misreads all of it: measured it producing a dispatcher
      // of "IO+CoroutineName" with the name lost entirely. Keep the list of
      // elements in order so applyCtxValue can walk them one by one.
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
   * Dispatches a call through THREE handler groups, in the same priority order
   * as before. A handler returning `undefined` means "not mine", so the call
   * falls through to the next group; returning a KValue — including UNIT —
   * means it's been fully handled.
   *
   * The order is PART OF THE SEMANTICS and must not be reordered. `Job()` must
   * land in the context-factory group; if it fell through to the "uppercase
   * name -> build an object" rule at the end, the __supervisor flag would
   * vanish without a trace.
   */
  protected *evalCall(e: Expr & { k: 'Call' }, env: Env): Eval<KValue> {
    // A shared name for both `foo()` and `x.foo()`. Each handler reads the
    // receiver itself when it needs it (join/await/cancel, and launch/async's
    // scopeReceiver), so don't infer "no receiver" from this variable — the
    // last group uses `name`.
    const calleeName = e.callee.k === 'Ident'
      ? e.callee.name
      : e.callee.k === 'Member' ? e.callee.name : null

    const suspension = yield* this.trySuspensionPoint(calleeName, e, env)
    if (suspension !== undefined) return suspension

    const builder = yield* this.tryBuilder(calleeName, e, env)
    if (builder !== undefined) return builder

    const ctxValue = yield* this.tryContextFactory(calleeName, e, env)
    if (ctxValue !== undefined) return ctxValue

    // `x.toString()` — one of the most common calls in Kotlin, and it used to
    // fall all the way down to the last branch and return Unit silently:
    // `println(i.toString())` printed "kotlin.Unit". Uses the same `display`
    // that the '+' operator between a string and a number uses, so `"" + i`
    // and `i.toString()` can never produce two different results.
    if (calleeName === 'toString' && e.callee.k === 'Member') {
      return { t: 'str', v: display(yield* this.evalExpr(e.callee.target, env)) }
    }

    const name = e.callee.k === 'Ident' ? e.callee.name : null

    // error(msg) is part of subset §4.1 and 3 of the original scenarios use it.
    // It used to fall to the last branch and silently return Unit:
    // println("before"); error("boom"); println("after") printed BOTH lines —
    // wrong without a trace. Real Kotlin: error(msg) = throw
    // IllegalStateException(msg.toString()), stopping execution right at the
    // call site. Placed BEFORE println so it doesn't fall through to the fallback.
    if (name === 'error') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      throw new KotlinThrow('IllegalStateException', display(arg), e.pos.line)
    }

    // ensureActive() is the standard idiom for a cancellable (cooperative
    // cancellation) loop: throws right at the call site if the enclosing
    // scope's job is no longer Active, instead of having to wait for the next
    // suspend point (delay/yield).
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

    // repeat(n) { } is part of subset §4.1 and is not on any deferred list.
    // Without it, it would fall to the last branch and return Unit silently:
    // it wouldn't run at all, and wouldn't report anything either.
    if (name === 'repeat') {
      const lambda = e.lambda
      const n = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      if (!lambda || n.t !== 'num') return UNIT
      let guard = 0
      for (let i = 0; i < n.v; i++) {
        if (++guard > 100_000) throw new KotlinThrow('IllegalStateException', 'Loop ran too long')
        const scope = env.child()
        // Single-parameter lambda: use the chosen name if given, otherwise `it` like Kotlin.
        scope.declare(lambda.params[0] ?? 'it', { t: 'num', v: i })
        // yield*, not a plain loop: a suspend point inside repeat must be able
        // to yield control just like everywhere else.
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
   * delay/yield/join/await/cancel/cancelAndJoin — calls that HAND CONTROL back
   * to the scheduler. Must be checked BEFORE every other group: `cancel` and
   * `join` are member-style calls on a Job, and if they fell through further
   * down, whichever branch caught them first would swallow the suspend point.
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
        // Only await READS the result — that's the entire difference between
        // the two calls, and it's the content of the launch/async lesson. The
        // scheduler throws directly into this generator if the Deferred has
        // already failed, so reaching the line below means it succeeded.
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
        // cancelAndJoin used to be wired straight into this branch and
        // silently NOT join, which produced exactly the wrong ordering that
        // learners use it to avoid: the statement after it would run before
        // the cancelled coroutine's finally had a chance to run.
        if (calleeName === 'cancelAndJoin') yield { s: 'join', jobId: jobId.v, line: e.pos.line }
      }
      return UNIT
    }
    return undefined
  }

  /**
   * runBlocking/coroutineScope/supervisorScope/withContext (run IN PLACE) and
   * launch/async (spawn a child coroutine that runs later).
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
      // `withContext(Dispatchers.X)` is the ONLY builder that can change the
      // dispatcher mid-flight. The other three don't accept a dispatcher
      // (coroutineScope / supervisorScope take no arguments; nested
      // runBlocking is out of the subset).
      //
      // `oldDispatcher` must be the REAL dispatcher of the currently running
      // task, not the structural parent job's — the two differ when
      // withContext is nested. `newDispatcher` is read from the ALREADY-MERGED
      // ctx of the job just created, not from the `ctx` built from the
      // arguments: `withContext(CoroutineName("x"))` sets no dispatcher at
      // all, and the argument-only ctx falls back to 'Default' — compared
      // against that, every withContext-that-only-renames would look like a
      // dispatcher change.
      const oldDispatcher = this.scheduler.currentDispatcher()
      const newDispatcher = this.scheduler.dispatcherOf(job.id)
      const needsSwitch = calleeName === 'withContext' && newDispatcher !== oldDispatcher
      if (needsSwitch) {
        yield { s: 'switchContext', jobId: job.id, dispatcher: newDispatcher, line: e.pos.line }
      }
      try {
        // The FIRST statement inside the try, and the ONLY push. Placing it in
        // `spawnInline` (i.e. before the `yield switchContext` above) would
        // leave a window where the push has happened but finally isn't
        // guarding it yet: a cancellation landing exactly at the dispatcher
        // switch would throw into the generator BEFORE the try, the pop would
        // never run, and the user's `finally { println(...) }` — tagged with
        // the withContext scope's id — would never have run its body. Measured
        // before fixing this; the regression test lives in dispatch.test.ts
        // "cancellation landing exactly at the dispatcher switch".
        this.scheduler.enterInline(job)
        return yield* this.runInlineBody(lambda.body, job, env)
      } finally {
        // `finally`, not two calls on two separate paths: an inline scope has
        // THREE exit paths (body finishes, body throws, a child of the scope
        // fails) and the third path goes through neither completeInline nor
        // failInline. Only `finally` can pair exactly ONE pop with each push.
        //
        // The three suspend points INSIDE the try where a cancellation can
        // land — the scope body, `joinChildren`, and the dispatcher switch on
        // the way back — all genuinely go through here now. Before Task 20
        // they did NOT: this comment used to overstate it — only the
        // dispatcher-switch point was actually correct.
        //   - scope body: `unwindCancelled` only looks at `task.job`, but the
        //     body of an inline scope runs inside the PARENT task (the parent
        //     job isn't cancelled), so the cancellation signal never arrived
        //     there. It now looks at `governingJob` — the top of the task's
        //     inline stack.
        //   - `joinChildren`: the signal did arrive, but `runInlineBody`
        //     caught it and then `yield joinChildren` again, so `body.throw()`
        //     RETURNED instead of throwing; the old scheduler discarded that
        //     IteratorResult and abandoned the generator mid-flight —
        //     `finally` never ran. The scheduler now brings it back onto the
        //     normal run path (see `unwindCancelled` and `Task.unwinding`).
        // The regression test for both cases lives in `inline-cancel.test.ts`.
        this.scheduler.exitInline(job)
        // Switch the dispatcher BACK, even on the throw path — cross-checked
        // against real Kotlin 2.1.20: after `try { withContext(Dispatchers.IO)
        // { throw ... } } catch`, both the catch and the statement after it
        // run on the `main` thread. `yield` inside `finally` is valid for a JS
        // generator and is the only way to guarantee that — the same reason
        // Kotlin's `finally` runs even when cancelled (spec §2.3).
        //
        // Placed AFTER exitInline: by this point the withContext job is
        // Completed and has left the stack, so the return-trip DISPATCH must
        // be tagged with the CALLING job (the one actually being resumed on
        // the old dispatcher), not the name of a scope that's already dead.
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
      // Grab it AND clear it right away, BEFORE evaluating the arguments:
      // in `launch(f()) { }`, if `f()` itself spawns something, that
      // coroutine would steal the variable name meant for this one.
      const varName = this.pendingVarName
      this.pendingVarName = undefined
      const argCtx = yield* this.contextFromArgs(e, env)
      // The receiver determines the PARENT and the base context. Ignoring it
      // would make `GlobalScope.launch { }` attach to the enclosing job just
      // like a plain launch — "GlobalScope escapes the job tree" is the lesson
      // this tool exists to teach, so the two must be distinguishable.
      const recv = yield* this.scopeReceiver(e, env)
      const parentJobId = recv ? recv.parentJobId : env.enclosingJobId
      const ctx = recv ? recv.ctx.plus(argCtx) : argCtx
      const body = lambda.body
      // No `this` alias (violates no-this-alias) — bind evalBlock instead.
      const evalBlock = this.evalBlock.bind(this)
      // The factory receives the freshly created Job, so the child Env carries this coroutine's own jobId.
      const job = this.scheduler.spawnChildOf(parentJobId, ctx, calleeName, varName, created =>
        (function* (): CoroutineBody {
          const v = yield* evalBlock(body, env.child(created.id))
          // A launch/async Job must NOT be Completed the moment its own body
          // finishes running — structured concurrency requires every child
          // (e.g. a launch nested inside a launch) to also finish first.
          // Without this step, the parent Job would look Completed while its
          // grandchild is still Active, so a subsequent parent.cancel() would
          // see job.isCompleted and no-op — the cancellation would never
          // reach the grandchild (the jobtree lesson).
          yield { s: 'joinChildren', jobId: created.id }
          // Return AFTER joinChildren: the value already existed before this,
          // but a Deferred is only considered done once all of its children
          // are also done. For launch, nobody reads this — join() only waits.
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
   * The body of an inline scope whose job `spawnInline` already created: runs
   * the body, waits for children, then closes the job through the correct
   * forward/backward path. Split out of `tryBuilder` so the dispatcher-switch
   * part (yielding in/out) can wrap this whole block in a single try/finally
   * without re-indenting all of the existing logic.
   */
  private *runInlineBody(body: Block, job: Job, env: Env): Eval<KValue> {
    let result: KValue
    try {
      // The scope body runs in an Env carrying the scope's jobId, so a launch
      // inside it attaches to the right parent even after a suspend/resume.
      result = yield* this.evalBlock(body, env.child(job.id))
      // coroutineScope/supervisorScope/runBlocking only return once every child is done.
      yield { s: 'joinChildren', jobId: job.id }
    } catch (err) {
      // Must NOT collapse both paths into `finally { completeInline(job) }`.
      // completeInline has no failure path, so an exception escaping the scope
      // body would report the scope as HAVING COMPLETED SUCCESSFULLY: nothing
      // would cancel its children and they'd keep running as orphans, and the
      // failure would never go through reportFailure. Exactly the semantics
      // this tool exists to teach against.
      if (err instanceof KotlinThrow) {
        this.scheduler.failInline(job, toCause(err))
        // Wait for the children to FINISH unwinding before rethrowing.
        // failInline just cancelled them, but cancellation only flips the Job
        // state — the `finally` block in the user's Kotlin code only runs once
        // the scheduler throws into the generator on a later loop iteration.
        // Skipping this step would let the caller's catch run BEFORE the
        // children's finally, the exact reverse of Kotlin: same underlying
        // failure R1, just reached via a different path (the scope body
        // throwing, instead of a child of the scope failing).
        yield { s: 'joinChildren', jobId: job.id }
        // The caller must see THIS SCOPE'S OWN FAILURE, not whatever just flew
        // through its body — same rule as the forward path at the end of this
        // function, just reached differently. The two diverge when the
        // cancellation signal comes in from OUTSIDE the body: with
        // `coroutineScope { launch { throw boom }; withContext(IO) { delay() } }`,
        // the withContext job gets dragged along by cancelJob and so receives
        // a CancellationException (its `failure` is not set), and if `err`
        // were simply rethrown, that CancellationException would sail straight
        // through the coroutineScope's frame out to the caller —
        // `catch (e: RuntimeException)` wouldn't match, and "boom" would
        // vanish. Cross-checked against real Kotlin: the caller sees "caught: boom".
        const failure = job.failure
        if (failure) throw new KotlinThrow(failure.exType, failure.message)
      } else {
        // A ReturnSignal (the `return` statement) is a NORMAL end of the
        // scope, not a failure — still completeInline as on the forward path.
        this.scheduler.completeInline(job)
      }
      throw err
    }
    // A child failed => the scope RETHROWS RIGHT HERE, i.e. in the caller's frame.
    //
    // Previously the rethrow happened indirectly: a child's failure would
    // bubble up marking the enclosing job Cancelled, and then unwindCancelled
    // would throw into its generator. That produced the right output but was
    // WRONG in two ways — the trace claimed runBlocking had died even though
    // the learner caught the exception (R2), and ancestors were thrown into
    // before descendants got to run their finally (R1). Throwing here fixes
    // both automatically: the joinChildren above already guaranteed every
    // child finished unwinding.
    //
    // `failure`, not `cause`: only a job that ACTUALLY failed rethrows here.
    // supervisorScope blocks a child's failure right at its boundary, so its
    // `failure` is null — exactly like Kotlin, the caller sees nothing at all.
    const failure = job.failure
    if (failure) throw new KotlinThrow(failure.exType, failure.message)
    this.scheduler.completeInline(job)
    return result
  }

  /**
   * SupervisorJob/Job/CoroutineScope/MainScope/CoroutineName — build a
   * CoroutineContext value, run nothing, and never suspend.
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
      // BOTH elements must be present. Missing the dispatcher would silently
      // fall back to Default; missing SupervisorJob would make the root Job
      // built below a REGULAR Job, and the single most classic Android pattern
      // would teach the opposite lesson — one failing child kills the whole scope.
      const arg = calleeName === 'MainScope'
        ? mainScopeCtxValue()
        : e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      // A REAL ROOT Job in the tree. Without it, `scope.launch` would be an
      // orphan job: the SupervisorJob() flag would drop out, `scope.cancel()`
      // would have nothing to cancel, and "the sibling is still alive" would
      // become true-for-the-wrong-reason (the two coroutines have no
      // relationship at all) instead of true because the supervisor actually
      // blocked the failure.
      //
      // Built for EVERY CoroutineScope(ctx), even when ctx has no Job: that's
      // exactly what kotlinx does — `CoroutineScope(ctx) = ContextScope(if
      // (ctx[Job] != null) ctx else ctx + Job())`. Cross-checked against real
      // Kotlin: `CoroutineScope(Dispatchers.Default).coroutineContext[Job]` is JobImpl{Active}.
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
    // The function body doesn't see the caller's local variables, BUT it does
    // inherit the enclosing coroutine scope — this is why a launch inside a
    // suspend fun attaches to the right parent.
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
   * The receiver of `x.launch { }` / `x.async { }`.
   *
   * Returning null means "no special receiver recognized, use the lexically
   * enclosing scope" — that's the path for `this.launch`, for `scope.launch`
   * where scope is a CoroutineScope passed into a suspend fun, and for every
   * call with no receiver at all.
   *
   * GlobalScope and CoroutineScope(ctx) BOTH hang outside the enclosing
   * coroutine — that's what lets them escape the caller's structured
   * concurrency. But they DIFFER right below that, and that difference is the
   * lesson:
   *   - `CoroutineScope(ctx)` carries a REAL ROOT Job (`__jobId`), so its
   *     children have a parent, are subject to `scope.cancel()`, and have a
   *     supervisor boundary to block at.
   *   - `GlobalScope` has an EMPTY context, no Job at all, so its children are
   *     genuinely orphaned: parentJobId = null. This is not a gap that needs "unifying".
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
   * Builds a CoroutineContext from a builder's arguments.
   * Accepts Dispatchers.X, CoroutineName(...), SupervisorJob(), and chains combined with '+'.
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
    // The Job element of the context. Before Task 5, both fell straight
    // through to `return ctx` and the supervisor flag got dropped right at
    // context-construction time: every `CoroutineScope(SupervisorJob())` ran
    // exactly like `CoroutineScope(Job())`. `Job()` must OVERWRITE it to
    // false, not "say nothing" — in `SupervisorJob() + Job()` the element must
    // be the right-hand one.
    if (v.className === 'SupervisorJob') return ctx.withSupervisor(true)
    if (v.className === 'Job') return ctx.withSupervisor(false)
    return ctx
  }
}

/**
 * `SupervisorJob() + Dispatchers.Main` as a KValue, in exactly the shape that
 * `evalBinary` produces for '+' between two context elements — so it flows
 * through `applyCtxValue` by the very same path that hand-written learner code takes.
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
