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
 * `fun main() = runBlocking { ... }` là dạng đặc biệt: trong Kotlin thật,
 * coroutine gốc DUY NHẤT chính là `runBlocking` đó — không có job nào phía
 * trên nó. Nếu để `main`'s exprBody đi qua `callFun` như bình thường, nó sẽ
 * chạm nhánh `runBlocking` trong `evalCall`, nhánh đó lại `spawnInline` thêm
 * MỘT job nữa bên dưới root job đã có sẵn — sinh ra hai lớp "runBlocking"
 * lồng nhau, sai so với ngôn ngữ đang dạy và khiến UI vẽ ra một coroutine
 * node không tồn tại. Nhận diện đúng dạng này để root job CHÍNH LÀ coroutine
 * runBlocking, không bọc thêm lớp nào. Dạng `fun main() { ... }` (block, có
 * `body`) không đụng tới — vẫn đi qua `callFun` như cũ.
 *
 * Chỉ unwrap khi KHÔNG có đối số (`runBlocking { }`, không phải
 * `runBlocking(Dispatchers.IO) { }`) — root job không đi qua contextFromArgs
 * nên đối số như dispatcher sẽ bị bỏ rơi âm thầm nếu unwrap bất chấp. Có đối
 * số thì để callFun/evalCall xử lý bình thường, dù lúc đó lại có hai job root
 * lồng nhau; đây là đánh đổi chấp nhận được cho một trường hợp hiếm.
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

  // Env gốc mang jobId của root, để runBlocking/launch ở tầng ngoài cùng
  // gắn vào đúng cây thay vì tạo ra một root thứ hai.
  scheduler.spawnRoot(rootJob => (function* (): CoroutineBody {
    const rootEnv = interp.globals.child(rootJob.id)
    if (lambda) {
      // Root job đã mang builder 'runBlocking' (xem Scheduler.spawnRoot) — nó
      // CHÍNH LÀ coroutine này, nên chạy thẳng thân lambda, không gọi callFun/
      // evalCall để tránh spawnInline tạo thêm job con trùng vai trò.
      const value = yield* interp.evalBlock(lambda.body, rootEnv)
      // Giống nhánh runBlocking trong evalCall: chỉ coi là xong khi mọi child
      // đã xong — nếu bỏ bước này, root có thể Completed trước launch bên
      // trong nó, sai trace dù output có thể vẫn đúng.
      yield { s: 'joinChildren', jobId: rootJob.id }
      // Giá trị của `runBlocking { }` gốc. Chưa ai đọc (không await được root),
      // nhưng trả đúng thứ thân nó cho ra thì rẻ hơn là bịa ra undefined.
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
 * Bọc `runSource` để KHÔNG BAO GIỜ ném. Editor sống gọi hàm này ở mỗi nhịp
 * gõ phím, mà source lúc đang gõ thì gần như luôn dở dang: `runSource` ném
 * ParseError/LexError ở phần lớn các trạng thái trung gian đó.
 *
 * `runSource` vẫn giữ nguyên hành vi ném — golden test của M1 dựa vào nó, và
 * ở trong test thì ném là đúng: hỏng thì phải ồn ào.
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
  // Lưới an toàn cuối. Nếu tới được đây thì engine có lỗi thật, nhưng UI vẫn
  // phải sống để user còn sửa được code. Ghi rõ là bất thường.
  return {
    severity: 'error',
    message: `Lỗi không mong đợi trong engine: ${err instanceof Error ? err.message : String(err)}`,
    line: 1, col: 1,
    hint: 'Đây có thể là lỗi của công cụ, không phải của code bạn viết.',
  }
}
