import type { Block, Expr, FunDecl, Program, Stmt } from '../ast/nodes'
import type { Scheduler } from '../runtime/scheduler'
import type { Suspension } from '../runtime/suspension'
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

  /** Task 16 thay thế bằng bản có coroutine builder. */
  protected *evalCall(e: Expr & { k: 'Call' }, env: Env): Eval<KValue> {
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
}
