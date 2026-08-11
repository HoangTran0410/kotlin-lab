import type { FunDecl, Lambda } from './ast/nodes'
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

/**
 * `fun main() = runBlocking { ... }` là dạng đặc biệt: trong Kotlin thật,
 * coroutine gốc DUY NHẤT chính là `runBlocking` đó — không có job nào phía
 * trên nó. Nếu để `main`'s exprBody đi qua `callFun` như bình thường, nó sẽ
 * chạm nhánh `runBlocking` trong `evalCall`, nhánh đó lại `spawnInline` thêm
 * MỘT job nữa bên dưới root job đã có sẵn — sinh ra hai lớp "runBlocking"
 * lồng nhau, sai so với ngôn ngữ đang dạy và khiến UI vẽ ra một coroutine
 * node không tồn tại. Nhận diện đúng dạng này để root job CHÍNH LÀ coroutine
 * runBlocking, không bọc thêm lớp nào. Dạng `fun main() { ... }` (block, có
 * `body`) không đụng tới — vẫn đi qua `callFun` như cũ.
 */
function runBlockingLambda(fn: FunDecl): Lambda | null {
  const call = fn.exprBody
  if (!call || call.k !== 'Call' || call.callee.k !== 'Ident' || call.callee.name !== 'runBlocking') {
    return null
  }
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

  // Env gốc mang jobId của root, để runBlocking/launch ở tầng ngoài cùng
  // gắn vào đúng cây thay vì tạo ra một root thứ hai.
  scheduler.spawnRoot(rootJob => (function* (): CoroutineBody {
    const rootEnv = interp.globals.child(rootJob.id)
    if (lambda) {
      // Root job đã mang builder 'runBlocking' (xem Scheduler.spawnRoot) — nó
      // CHÍNH LÀ coroutine này, nên chạy thẳng thân lambda, không gọi callFun/
      // evalCall để tránh spawnInline tạo thêm job con trùng vai trò.
      yield* interp.evalBlock(lambda.body, rootEnv)
      // Giống nhánh runBlocking trong evalCall: chỉ coi là xong khi mọi child
      // đã xong — nếu bỏ bước này, root có thể Completed trước launch bên
      // trong nó, sai trace dù output có thể vẫn đúng.
      yield { s: 'joinChildren', jobId: rootJob.id }
    } else {
      yield* interp.callFun(main, [], rootEnv)
    }
  })())
  scheduler.runToCompletion()

  const events = scheduler.emitter.events
  return {
    diagnostics: [],
    events,
    output: events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text),
  }
}
