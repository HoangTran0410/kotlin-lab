import type { JobId } from '../trace/events'

/**
 * `line` là dòng 1-based của biểu thức GÂY RA suspend (`delay(100)`, `j.join()`,
 * `d.await()`). Interpreter là nơi duy nhất biết được nó — scheduler chỉ thấy
 * generator đã yield ra cái gì. Optional vì `joinChildren` do builder sinh ra
 * chứ không do một dòng code nào của user.
 */
export type Suspension =
  | { s: 'delay'; ms: number; line?: number }
  | { s: 'join'; jobId: JobId; line?: number }
  | { s: 'await'; jobId: JobId; line?: number }
  /** Chờ MỌI child của jobId kết thúc. coroutineScope/supervisorScope dùng cái này. */
  | { s: 'joinChildren'; jobId: JobId; line?: number }
  | { s: 'yield'; line?: number }

/** Thân coroutine: generator yield ra điểm suspend, nhận lại giá trị resume. */
export type CoroutineBody = Generator<Suspension, void, unknown>
