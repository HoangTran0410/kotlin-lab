import type { JobId } from '../trace/events'

export type Suspension =
  | { s: 'delay'; ms: number }
  | { s: 'join'; jobId: JobId }
  | { s: 'await'; jobId: JobId }
  /** Chờ MỌI child của jobId kết thúc. coroutineScope/supervisorScope dùng cái này. */
  | { s: 'joinChildren'; jobId: JobId }
  | { s: 'yield' }

/** Thân coroutine: generator yield ra điểm suspend, nhận lại giá trị resume. */
export type CoroutineBody = Generator<Suspension, unknown, unknown>
