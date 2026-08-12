import type { FunDecl, Lambda } from './ast/nodes'
import { parseProgram, ParseError } from './parser/parser'
import { LexError } from './lexer/lexer'
import { Interpreter } from './interpreter/interpreter'
import { Scheduler } from './runtime/scheduler'
import { validate } from './validator/validator'
import type { Diagnostic } from './validator/diagnostics'
import type { Event } from './trace/events'
import type { CoroutineBody } from './runtime/suspension'

export interface RunResult {
  diagnostics: Diagnostic[]
  events: Event[]
  output: string[]
}

/**
 * `fun main() = runBlocking { ... }` is a special form: in real Kotlin, the
 * ONE root coroutine is precisely that `runBlocking` — there is no job above
 * it. If `main`'s exprBody were run through `callFun` normally, it would hit
 * the `runBlocking` branch in `evalCall`, which would `spawnInline` yet
 * ANOTHER job below the root job that already exists — producing two nested
 * layers of "runBlocking", diverging from the language being taught and
 * making the UI draw a coroutine node that doesn't exist. This form is
 * recognized specially so the root job IS the runBlocking coroutine, with no
 * extra wrapping layer. The `fun main() { ... }` form (block, with a `body`)
 * is left untouched — it still goes through `callFun` as before.
 *
 * Only unwrapped when there are NO arguments (`runBlocking { }`, not
 * `runBlocking(Dispatchers.IO) { }`) — the root job doesn't go through
 * contextFromArgs, so an argument like a dispatcher would get silently
 * dropped if unwrapped unconditionally. With arguments, callFun/evalCall
 * handle it as usual, even though that produces two nested root jobs; an
 * acceptable trade-off for a rare case.
 */
function runBlockingLambda(fn: FunDecl): Lambda | null {
  const call = fn.exprBody
  if (!call || call.k !== 'Call' || call.callee.k !== 'Ident' || call.callee.name !== 'runBlocking') {
    return null
  }
  if (call.args.length !== 0) return null
  return call.lambda
}

export function runSource(src: string): RunResult {
  const program = parseProgram(src)
  const diagnostics = validate(program)
  if (diagnostics.length > 0) return { diagnostics, events: [], output: [] }

  const scheduler = new Scheduler()
  const interp = new Interpreter(scheduler, program)
  const main = interp.lookupFun('main')!
  const lambda = runBlockingLambda(main)

  // The root Env carries the root's jobId, so runBlocking/launch at the
  // outermost level attach to the right tree instead of creating a second root.
  scheduler.spawnRoot(rootJob => (function* (): CoroutineBody {
    const rootEnv = interp.globals.child(rootJob.id)
    if (lambda) {
      // The root job already carries the 'runBlocking' builder (see
      // Scheduler.spawnRoot) — it IS this coroutine, so run the lambda body
      // directly, without calling callFun/evalCall, to avoid spawnInline
      // creating an extra, duplicate-role child job.
      const value = yield* interp.evalBlock(lambda.body, rootEnv)
      // Same as the runBlocking branch in evalCall: only considered done once
      // every child is done — skipping this step would let the root become
      // Completed before a launch inside it, producing a wrong trace even if
      // the output happens to still be correct.
      yield { s: 'joinChildren', jobId: rootJob.id }
      // The value of the root `runBlocking { }`. Nobody reads it yet (the
      // root can't be awaited), but returning whatever its body actually
      // produces is cheaper than making up undefined.
      return value
    }
    return yield* interp.callFun(main, [], rootEnv)
  })())
  scheduler.runToCompletion()

  const events = scheduler.emitter.events
  return {
    diagnostics: [],
    events,
    output: events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text),
  }
}

/**
 * Wraps `runSource` so it NEVER throws. The live editor calls this function on
 * every keystroke, and source mid-keystroke is almost always incomplete:
 * `runSource` throws ParseError/LexError for most of those in-between states.
 *
 * `runSource` itself keeps its throwing behavior — M1's golden test relies on
 * it, and inside a test throwing is correct: if it's broken, it should be loud
 * about it.
 */
export function runSourceSafe(src: string): RunResult {
  try {
    return runSource(src)
  } catch (err) {
    return { diagnostics: [toDiagnostic(err)], events: [], output: [] }
  }
}

function toDiagnostic(err: unknown): Diagnostic {
  if (err instanceof ParseError || err instanceof LexError) {
    return { severity: 'error', message: err.message, line: err.pos.line, col: err.pos.col }
  }
  // Last safety net. Reaching this point means the engine has a real bug, but
  // the UI still has to stay alive so the user can keep editing their code.
  // Flag it clearly as abnormal.
  return {
    severity: 'error',
    message: `Unexpected error in the engine: ${err instanceof Error ? err.message : String(err)}`,
    line: 1, col: 1,
    hint: 'This might be a bug in the tool, not in the code you wrote.',
  }
}
