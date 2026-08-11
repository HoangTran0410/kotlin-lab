import { parseProgram } from './parser/parser'
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

export function runSource(src: string): RunResult {
  const program = parseProgram(src)
  const diagnostics = validate(program)
  if (diagnostics.length > 0) return { diagnostics, events: [], output: [] }

  const scheduler = new Scheduler()
  const interp = new Interpreter(scheduler, program)
  const main = interp.lookupFun('main')!

  // Env gốc mang jobId của root, để runBlocking/launch ở tầng ngoài cùng
  // gắn vào đúng cây thay vì tạo ra một root thứ hai.
  scheduler.spawnRoot(rootJob => (function* (): CoroutineBody {
    yield* interp.callFun(main, [], interp.globals.child(rootJob.id))
  })())
  scheduler.runToCompletion()

  const events = scheduler.emitter.events
  return {
    diagnostics: [],
    events,
    output: events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text),
  }
}
