import type { Block, Expr, Pos, Program, Stmt } from '../ast/nodes'
import { UNSUPPORTED, type Diagnostic } from './diagnostics'

/**
 * Builders that create/run a coroutine body — the EXACT set of names that
 * `tryBuilder` in interpreter.ts recognizes. Only the lambda body of these
 * calls has an enclosing CoroutineScope; this is the condition for a bare
 * `isActive`/`ensureActive()` to be valid (real Kotlin: both are extensions on
 * CoroutineScope/CoroutineContext).
 */
const COROUTINE_BUILDERS = new Set([
  'launch', 'async', 'runBlocking', 'coroutineScope', 'supervisorScope', 'withContext',
])

/**
 * Looks up the UNSUPPORTED table WITHOUT touching Object.prototype.
 *
 * A bare `UNSUPPORTED[name]` also reads inherited members: `toString`,
 * `valueOf`, `constructor`, `hasOwnProperty`... Measured before fixing this —
 * `i.toString()` (one of the most common calls in Kotlin) was reported as
 * "'toString' is not supported", with `hint` being a FUNCTION leaking straight
 * into the UI; and a variable named `valueOf` was blocked too, despite having
 * nothing to do with any of this.
 */
function unsupportedHint(name: string): string | undefined {
  return Object.hasOwn(UNSUPPORTED, name) ? UNSUPPORTED[name] : undefined
}

/**
 * Names usable without a declaration — anything the interpreter recognizes on its own.
 *
 * Only lowercase names are listed: an identifier starting with an uppercase
 * letter is treated as a type/constructor name (`RuntimeException("x")`,
 * `Dispatchers.IO`, `GlobalScope`, `SupervisorJob()`) and is never questioned —
 * exactly like the interpreter does (`/^[A-Z]/` -> build an object).
 *
 * This list must stay in sync with evalCall/trySuspensionPoint/tryBuilder.
 * What keeps it from drifting is the lesson and example set itself: 13
 * lessons and 19 examples on the about page are all run through `validate` in
 * tests and must come back clean. Missing a name here turns a lesson red
 * immediately.
 */
const BUILTIN_VALUES = new Set([
  // Readable as a VALUE, no declaration needed.
  'it',        // implicit parameter of a single-parameter lambda
  'this',      // receiver of the enclosing scope — `work(this)`
  'isActive',  // property of CoroutineScope; has its own separate check for misuse
])

export function validate(program: Program): Diagnostic[] {
  const out: Diagnostic[] = []

  if (!program.funs.some(f => f.name === 'main')) {
    out.push({
      severity: 'error',
      message: 'No fun main() found. The program needs an entry point named main.',
      line: 1, col: 1,
      hint: 'Add: fun main() = runBlocking { ... }',
    })
  }

  // Scope stack: each element is the set of names declared (ValDecl/function
  // param/lambda param/catch variable/for variable) IN that exact block.
  // `isDeclared` searches the WHOLE stack — the same parent chain that
  // `Env.get`/`Env.has` (interpreter/env.ts) search at runtime. This is needed
  // so that `val isActive = true` declared by the learner does NOT get
  // flagged: interpreter.ts:119 already set this precedent
  // (`!env.has('isActive')`) — if the validator didn't know a variable had
  // been declared, it would block code that is 100% valid in real Kotlin.
  // There's always at least one root element, never popped away entirely.
  const scopes: Set<string>[] = [new Set()]
  const isDeclared = (name: string): boolean => scopes.some(sc => sc.has(name))
  const declare = (name: string): void => { scopes[scopes.length - 1]!.add(name) }

  // `inCoroutine`: currently walking inside the lambda body of one of the
  // builders above (nesting depth doesn't matter — while/for/if/try, or a
  // plain lambda like repeat()'s, all INHERIT this flag; they don't change the
  // coroutine boundary on their own). Defaults to false: the body of any `fun`
  // (including a block-form main) does not automatically have a CoroutineScope,
  // exactly matching real Kotlin reporting "Unresolved reference" for a bare
  // `isActive`/`ensureActive()` written outside every builder.
  /**
   * Three checks on one identifier. `isCallee` = the identifier is in a CALL
   * position (`foo(...)`), as opposed to a value position (`foo`, `foo.bar`).
   *
   * Split out because both positions need the first two checks —
   * `ensureActive()` outside a coroutine must be flagged, and an unsupported
   * `withTimeout(...)` must be flagged too — but only the VALUE position needs
   * the "has it been declared" check.
   */
  const checkIdent = (name: string, pos: Pos, inCoroutine: boolean, isCallee: boolean): void => {
    if ((name === 'isActive' || name === 'ensureActive') && !inCoroutine && !isDeclared(name)) {
      out.push({
        severity: 'error',
        message: `'${name}' can only be used inside a coroutine — real Kotlin reports `
          + `unresolved reference outside the body of launch/async/runBlocking/coroutineScope/`
          + 'supervisorScope/withContext.',
        line: pos.line, col: pos.col,
        hint: 'Put it inside the body of one of the builders above, or read it through a specific Job variable (job.isActive).',
      })
    }
    const hint = unsupportedHint(name)
    if (hint) {
      out.push({
        severity: 'error',
        message: `'${name}' is not supported in this version.`,
        line: pos.line, col: pos.col, hint,
      })
      return
    }
    // A lowercase name, used as a VALUE, that hasn't been declared anywhere.
    //
    // A real case this caught: `supervisorScope.launch { }` when the learner
    // forgot to write `val supervisorScope = CoroutineScope(...)`. Real Kotlin
    // fails to compile ("Unresolved reference"); the engine used to silently
    // build a garbage object carrying that exact name, `scopeReceiver` didn't
    // recognize it, so the call ran exactly like a bare `launch { }` — same
    // parent, same rules. The lesson about a silent supervisor quietly taught
    // the opposite, with nothing reported.
    //
    // Two limits, INTENTIONAL, stated plainly so nobody assumes this checks
    // more than it does:
    //   - Only lowercase names. An uppercase-starting name is a type/
    //     constructor name, and the interpreter deliberately builds an object
    //     for those (`RuntimeException("x")`).
    //   - Only the VALUE position. An unknown function is a different matter:
    //     `flowOf(1)` is a real kotlinx function this engine hasn't
    //     implemented yet, and Flow belongs to a later milestone. Folding
    //     both into one message would get one of them wrong.
    if (!isCallee && !/^[A-Z]/.test(name) && !BUILTIN_VALUES.has(name) && !isDeclared(name)) {
      out.push({
        severity: 'error',
        message: `'${name}' has not been declared — real Kotlin reports "Unresolved reference".`,
        line: pos.line, col: pos.col,
        hint: 'Check the spelling, or declare it with val/var before using it.',
      })
    }
  }

  const visitExpr = (e: Expr, inCoroutine: boolean): void => {
    switch (e.k) {
      case 'Ident': checkIdent(e.name, e.pos, inCoroutine, false); break
      case 'Member': {
        const hint = unsupportedHint(e.name)
        if (hint) out.push({
          severity: 'error',
          message: `'${e.name}' is not supported in this version.`,
          line: e.pos.line, col: e.pos.col, hint,
        })
        visitExpr(e.target, inCoroutine)
        break
      }
      case 'Call': {
        // An Ident-shaped callee does NOT go through the "has it been
        // declared" check in case 'Ident': built-in function names (`launch`,
        // `delay`, `println`...) don't live in any scope, and an unknown
        // function belongs to a different category (see the note on case
        // 'Ident'). Still walked so UNSUPPORTED gets caught as before.
        if (e.callee.k === 'Ident') checkIdent(e.callee.name, e.callee.pos, inCoroutine, true)
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
      // Declared AFTER visiting init — matching the real runtime order
      // (Env.declare runs after evalExpr(s.init)), so `val isActive = isActive`
      // (with nothing enclosing it) still flags an error on the right-hand
      // side just like real Kotlin, instead of shadowing itself.
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

  // A block ALWAYS opens its own scope (matching `env.child()` at runtime for
  // while/for/try/if/lambda...) and pops it back on the way out — this is what
  // makes the "a variable declared inside a block doesn't leak outside" case
  // distinguishable: dropping the `scopes.pop()` line is exactly the kind of
  // break that test guards against.
  const visitBlockWithNames = (b: Block, inCoroutine: boolean, names: readonly string[]): void => {
    scopes.push(new Set())
    names.forEach(declare)
    b.stmts.forEach(s => visitStmt(s, inCoroutine))
    scopes.pop()
  }
  const visitBlock = (b: Block, inCoroutine: boolean): void => visitBlockWithNames(b, inCoroutine, [])

  // Function names go into the root scope BEFORE walking any body: a function
  // calling a function declared after it, and a function calling itself, are
  // both valid in Kotlin.
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
