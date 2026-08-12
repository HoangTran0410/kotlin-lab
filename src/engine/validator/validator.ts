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
  'withTimeout', 'withTimeoutOrNull',
])

/** Calls the interpreter executes directly. Everything else must be declared by the learner. */
const BUILTIN_CALLS = new Set([
  'delay', 'yield', 'join', 'await', 'cancel', 'cancelAndJoin',
  'launch', 'async', 'runBlocking', 'coroutineScope', 'supervisorScope', 'withContext',
  'withTimeout', 'withTimeoutOrNull',
  'SupervisorJob', 'Job', 'CoroutineScope', 'MainScope', 'CoroutineName',
  'CoroutineExceptionHandler', 'println', 'repeat', 'error', 'ensureActive', 'toString',
])

const HANDLER_SUSPENDING_CALLS = new Set([
  'delay', 'yield', 'join', 'await', 'cancelAndJoin',
  'launch', 'async', 'runBlocking', 'coroutineScope', 'supervisorScope', 'withContext',
  'withTimeout', 'withTimeoutOrNull',
])

function blockContainsThrow(block: Block): boolean {
  const stmtContains = (stmt: Stmt): boolean => {
    switch (stmt.k) {
      case 'Throw': return true
      case 'While': return blockContainsThrow(stmt.body)
      case 'For': return blockContainsThrow(stmt.body)
      case 'Try':
        return blockContainsThrow(stmt.body)
          || stmt.catches.some(c => blockContainsThrow(c.block))
          || (stmt.finallyBlock !== null && blockContainsThrow(stmt.finallyBlock))
      default: return false
    }
  }
  return block.stmts.some(stmtContains)
}

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

function exprContains(e: Expr, predicate: (e: Expr) => boolean): boolean {
  if (predicate(e)) return true
  switch (e.k) {
    case 'Unary': return exprContains(e.operand, predicate)
    case 'Binary': return exprContains(e.left, predicate) || exprContains(e.right, predicate)
    case 'Range': return exprContains(e.from, predicate) || exprContains(e.to, predicate)
    case 'Member': return exprContains(e.target, predicate)
    case 'Call':
      return exprContains(e.callee, predicate)
        || e.args.some(a => exprContains(a.value, predicate))
        || (e.lambda !== null && blockContains(e.lambda.body, predicate))
    case 'LambdaExpr': return blockContains(e.lambda.body, predicate)
    case 'IfExpr':
      return exprContains(e.cond, predicate) || blockContains(e.thenBlock, predicate)
        || (e.elseBlock !== null && blockContains(e.elseBlock, predicate))
    case 'WhenExpr':
      return (e.subject !== null && exprContains(e.subject, predicate))
        || e.branches.some(b => (b.cond !== null && exprContains(b.cond, predicate))
          || (b.block !== null && blockContains(b.block, predicate))
          || (b.expr !== null && exprContains(b.expr, predicate)))
    case 'StringLit':
      return e.parts.some(p => p.type === 'expr' && exprContains(p.expr, predicate))
    default: return false
  }
}

function blockContains(block: Block, predicate: (e: Expr) => boolean): boolean {
  const stmtContains = (stmt: Stmt): boolean => {
    switch (stmt.k) {
      case 'ValDecl': return exprContains(stmt.init, predicate)
      case 'Assign': return exprContains(stmt.target, predicate) || exprContains(stmt.value, predicate)
      case 'ExprStmt': return exprContains(stmt.expr, predicate)
      case 'While': return exprContains(stmt.cond, predicate) || blockContains(stmt.body, predicate)
      case 'For': return exprContains(stmt.iterable, predicate) || blockContains(stmt.body, predicate)
      case 'Try':
        return blockContains(stmt.body, predicate)
          || stmt.catches.some(c => blockContains(c.block, predicate))
          || (stmt.finallyBlock !== null && blockContains(stmt.finallyBlock, predicate))
      case 'Throw': return exprContains(stmt.expr, predicate)
      case 'Return': return stmt.expr !== null && exprContains(stmt.expr, predicate)
    }
  }
  return block.stmts.some(stmtContains)
}

const containsIdent = (e: Expr, name: string): boolean =>
  exprContains(e, candidate => candidate.k === 'Ident' && candidate.name === name)

const blockContainsCall = (block: Block | undefined, names: ReadonlySet<string>): boolean =>
  block !== undefined && blockContains(block, candidate => candidate.k === 'Call'
    && ((candidate.callee.k === 'Ident' && names.has(candidate.callee.name))
      || (candidate.callee.k === 'Member' && names.has(candidate.callee.name))))

export function validate(program: Program): Diagnostic[] {
  const out: Diagnostic[] = []
  const functionNames = new Set(program.funs.map(f => f.name))
  const suspendingFunctionNames = new Set(program.funs.filter(f => f.isSuspend).map(f => f.name))
  const unsafeHandlerFunctions = new Set(suspendingFunctionNames)
  const unsafeHandlerCalls = new Set([...HANDLER_SUSPENDING_CALLS, 'error'])
  let changed = true
  while (changed) {
    changed = false
    const unsafeCalls = new Set([...unsafeHandlerCalls, ...unsafeHandlerFunctions])
    for (const fn of program.funs) {
      if (unsafeHandlerFunctions.has(fn.name)) continue
      const unsafe = (fn.body !== null
          && (blockContainsThrow(fn.body) || blockContainsCall(fn.body, unsafeCalls)))
        || (fn.exprBody !== null && exprContains(fn.exprBody, candidate => candidate.k === 'Call'
          && ((candidate.callee.k === 'Ident' && unsafeCalls.has(candidate.callee.name))
            || (candidate.callee.k === 'Member' && unsafeCalls.has(candidate.callee.name)))))
      if (unsafe) {
        unsafeHandlerFunctions.add(fn.name)
        changed = true
      }
    }
  }
  let allowNonCancellable = false

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
  type ReceiverKind = 'scope' | 'job' | 'deferred' | 'other'
  const receiverScopes: Map<string, ReceiverKind>[] = [new Map()]
  const isDeclared = (name: string): boolean => scopes.some(sc => sc.has(name))
  const declare = (name: string, kind: ReceiverKind = 'other'): void => {
    scopes[scopes.length - 1]!.add(name)
    receiverScopes[receiverScopes.length - 1]!.set(name, kind)
  }
  const receiverKind = (name: string): ReceiverKind | undefined => {
    for (let i = receiverScopes.length - 1; i >= 0; i--) {
      const kind = receiverScopes[i]!.get(name)
      if (kind !== undefined) return kind
    }
    return undefined
  }
  const inferredKind = (e: Expr): ReceiverKind => {
    if (e.k !== 'Call') return 'other'
    const name = e.callee.k === 'Ident' || e.callee.k === 'Member' ? e.callee.name : null
    if (name === 'CoroutineScope' || name === 'MainScope') return 'scope'
    if (name === 'Job' || name === 'SupervisorJob') return 'job'
    if (name === 'launch') return 'job'
    if (name === 'async') return 'deferred'
    return 'other'
  }

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
    if (name === 'NonCancellable' && !allowNonCancellable) {
      out.push({
        severity: 'error',
        message: `'NonCancellable' is only supported as withContext(NonCancellable) for cleanup.`,
        line: pos.line, col: pos.col,
        hint: 'Other placements change Job structure in ways this simulator does not model.',
      })
      return
    }
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
    const knownCall = BUILTIN_CALLS.has(name) || functionNames.has(name)
      || /(?:Exception|Error)$/.test(name)
    if (isCallee && !knownCall) {
      out.push({
        severity: 'error',
        message: `'${name}' is not a call this simulator can execute — check the spelling or use a supported API.`,
        line: pos.line, col: pos.col,
        hint: 'Unknown calls are rejected instead of silently returning kotlin.Unit.',
      })
    } else if (!isCallee && !/^[A-Z]/.test(name) && !BUILTIN_VALUES.has(name) && !isDeclared(name)) {
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
        else {
          visitExpr(e.callee, inCoroutine)
          if (e.callee.k === 'Member' && !unsupportedHint(e.callee.name)
              && !BUILTIN_CALLS.has(e.callee.name)) {
            out.push({
              severity: 'error',
              message: `'${e.callee.name}' is not a call this simulator can execute.`,
              line: e.callee.pos.line, col: e.callee.pos.col,
              hint: 'Unknown calls are rejected instead of silently returning kotlin.Unit.',
            })
          }
        }
        const calleeName = e.callee.k === 'Ident' ? e.callee.name
          : e.callee.k === 'Member' ? e.callee.name : null
        if (e.callee.k === 'Ident'
            && (calleeName === 'join' || calleeName === 'await' || calleeName === 'cancelAndJoin')) {
          out.push({
            severity: 'error',
            message: `'${calleeName}' requires a Job or Deferred receiver in this simulator.`,
            line: e.callee.pos.line, col: e.callee.pos.col,
            hint: `Call it as job.${calleeName}() on a declared coroutine value.`,
          })
        }
        const receiverIsUndeclared = e.callee.k === 'Member'
          && e.callee.target.k === 'Ident'
          && !/^[A-Z]/.test(e.callee.target.name)
          && !BUILTIN_VALUES.has(e.callee.target.name)
          && !isDeclared(e.callee.target.name)
        const receiver = e.callee.k === 'Member' ? e.callee.target : null
        const kind = receiver?.k === 'Ident' ? receiverKind(receiver.name) : undefined
        const validMemberReceiver = calleeName === 'toString'
          || ((calleeName === 'launch' || calleeName === 'async') && receiver?.k === 'Ident'
            && (receiver.name === 'this' || receiver.name === 'GlobalScope' || kind === 'scope'))
          || ((calleeName === 'join' || calleeName === 'cancelAndJoin')
            && (kind === 'job' || kind === 'deferred'))
          || (calleeName === 'cancel' && (kind === 'scope' || kind === 'job' || kind === 'deferred'))
          || (calleeName === 'await' && kind === 'deferred')
        if (e.callee.k === 'Member' && calleeName !== null && BUILTIN_CALLS.has(calleeName)
            && !receiverIsUndeclared && !validMemberReceiver) {
          out.push({
            severity: 'error',
            message: `'${calleeName}' has a receiver shape this simulator cannot model honestly.`,
            line: e.callee.pos.line, col: e.callee.pos.col,
            hint: 'Use a declared Job/Deferred/CoroutineScope variable, this, or GlobalScope as the receiver.',
          })
        }
        if ((calleeName === 'launch' || calleeName === 'async')
            && e.args.some(a => containsIdent(a.value, 'NonCancellable'))) {
          out.push({
            severity: 'error',
            message: `'NonCancellable' is only supported as withContext(NonCancellable) for cleanup.`,
            line: e.pos.line, col: e.pos.col,
            hint: 'Use withContext(NonCancellable) inside finally; do not create launch/async coroutines with it.',
          })
        }
        if (calleeName === 'CoroutineExceptionHandler') {
          const handlerUnsafeCalls = new Set([...unsafeHandlerCalls, ...unsafeHandlerFunctions])
          if (!e.lambda || e.lambda.params.length !== 2
              || blockContainsThrow(e.lambda.body)
              || blockContainsCall(e.lambda.body, handlerUnsafeCalls)) {
            out.push({
              severity: 'error',
              message: 'This CoroutineExceptionHandler form cannot be modeled honestly.',
              line: e.pos.line, col: e.pos.col,
              hint: 'Use CoroutineExceptionHandler { _, e -> ... } with a non-suspending body.',
            })
          }
        }
        e.args.forEach(a => {
          const previous = allowNonCancellable
          allowNonCancellable = calleeName === 'withContext' && e.args.length === 1
            && a.value.k === 'Ident' && a.value.name === 'NonCancellable'
          visitExpr(a.value, inCoroutine)
          allowNonCancellable = previous
        })
        if (e.lambda) {
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
      case 'ValDecl': visitExpr(s.init, inCoroutine); declare(s.name, inferredKind(s.init)); break
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
    receiverScopes.push(new Map())
    names.forEach(name => declare(name))
    b.stmts.forEach(s => visitStmt(s, inCoroutine))
    scopes.pop()
    receiverScopes.pop()
  }
  const visitBlock = (b: Block, inCoroutine: boolean): void => visitBlockWithNames(b, inCoroutine, [])

  // Function names go into the root scope BEFORE walking any body: a function
  // calling a function declared after it, and a function calling itself, are
  // both valid in Kotlin.
  program.funs.forEach(f => declare(f.name))

  program.topLevel.forEach(s => visitStmt(s, false))
  program.funs.forEach(f => {
    scopes.push(new Set())
    receiverScopes.push(new Map())
    f.params.forEach(p => {
      declare(p.name, p.type === 'CoroutineScope' ? 'scope'
        : p.type === 'Deferred' ? 'deferred'
        : p.type === 'Job' ? 'job' : 'other')
      if (p.defaultValue) visitExpr(p.defaultValue, false)
    })
    if (f.body) visitBlock(f.body, false)
    if (f.exprBody) visitExpr(f.exprBody, false)
    scopes.pop()
    receiverScopes.pop()
  })

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}
