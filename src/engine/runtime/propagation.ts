import type { TraceEmitter } from '../trace/emitter'
import type { JobId } from '../trace/events'
import type { FailureCause, Job } from './job'

/**
 * Cancel đi XUỐNG: cancel một Job kéo theo toàn bộ descendant.
 * Idempotent — gọi trên Job đã kết thúc là no-op.
 */
export function cancelJob(
  job: Job,
  cause: FailureCause,
  emitter: TraceEmitter,
  from: JobId | 'user',
): void {
  if (job.isCompleted) return

  // Con trước, theo thứ tự khai báo — quyết định tính deterministic của trace.
  // Ghi lại chính hành động cancel này TRƯỚC khi lan xuống. Nếu bỏ, hành động
  // khởi đầu (user gọi job.cancel(), hay parent fail kéo theo) không hề xuất
  // hiện trong trace và UI không có gì để vẽ ở bước đầu tiên.
  emitter.emit({ k: 'CANCEL_REQUESTED', from, to: job.id, cause: cause.exType })

  for (const child of job.children) {
    if (child.isCompleted) continue
    cancelJob(child, cause, emitter, job.id)
  }

  const prev = job.state
  if (prev !== 'Cancelling') {
    job.transitionTo('Cancelling')
    emitter.emit({ k: 'JOB_STATE', id: job.id, from: prev, to: 'Cancelling', cause: cause.exType })
  }
  job.cause = cause
  job.transitionTo('Cancelled')
  emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType })
}

/**
 * Failure đi LÊN. Ba luật, đúng theo kotlinx.coroutines:
 *
 * 1. CancellationException là kết thúc bình thường — KHÔNG làm parent fail.
 * 2. Parent thường: fail theo, rồi cancel mọi sibling còn lại.
 * 3. Parent là supervisor: chặn tại boundary — parent không fail,
 *    sibling không bị đụng tới. (Exception chưa xử lý vẫn đi tiếp tới
 *    handler — việc đó do scheduler làm, không phải ở đây.)
 */
/** Đưa một job về trạng thái kết thúc bất thường, phát đủ hai chặng JOB_STATE. */
function terminateAsFailed(job: Job, cause: FailureCause, emitter: TraceEmitter): void {
  if (job.isCompleted) return
  const prev = job.state
  if (prev !== 'Cancelling') {
    job.transitionTo('Cancelling')
    emitter.emit({ k: 'JOB_STATE', id: job.id, from: prev, to: 'Cancelling', cause: cause.exType })
  }
  job.cause = cause
  // Đây là đường FAIL, không phải đường cancel: thân coroutine phải nhận lại
  // đúng exception gốc khi unwind. cancelJob cố ý KHÔNG đặt trường này.
  job.failure = cause
  job.transitionTo('Cancelled')
  emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType })
}

export function reportFailure(child: Job, cause: FailureCause, emitter: TraceEmitter): void {
  child.cause = cause

  // Structured concurrency: một coroutine fail phải cancel CHÍNH CON CỦA NÓ
  // trước khi coi là xong — không chỉ sibling ở các tầng tổ tiên. Thiếu bước
  // này thì con của job fail tiếp tục chạy tự do sau khi cha đã Cancelled,
  // vi phạm nguyên tắc nền tảng nhất mà công cụ này dạy.
  for (const c of child.children) {
    if (c.isCompleted) continue
    cancelJob(c, cause, emitter, child.id)
  }

  terminateAsFailed(child, cause, emitter)

  if (cause.isCancellation) return

  // Failure đi lên QUA NHIỀU TẦNG, không chỉ một bậc. Nếu chỉ báo cho parent
  // trực tiếp rồi dừng thì với cây R -> P -> {A,B,C} toàn Job thường, B fail
  // sẽ giết P và A/C nhưng R vẫn sống — sai hẳn so với Kotlin. Nó cũng làm
  // mất sự kiện FAILURE_PROPAGATED chạm tới ranh giới supervisor, thứ mà UI
  // cần để vẽ bài học "nested supervisor trap".
  let node = child
  for (;;) {
    const parent = node.parent
    if (!parent) return

    emitter.emit({
      k: 'FAILURE_PROPAGATED',
      from: node.id,
      to: parent.id,
      blockedBySupervisor: parent.isSupervisor,
    })

    // Ranh giới scope (coroutineScope/supervisorScope/withContext).
    //
    // Exception ĐI TỚI khung của cha — nên FAILURE_PROPAGATED ở trên vẫn được
    // phát, UI vẫn vẽ được đường đi — nhưng job cha KHÔNG chết theo: kotlinx
    // trả exception vào continuation của người gọi, để try/catch quanh chỗ gọi
    // bắt được (JobSupport.cancelParent: `if (isScopedCoroutine) return true`).
    // Việc ném lại tại chỗ gọi do interpreter làm sau khi joinChildren xong.
    //
    // Đặt TRƯỚC nhánh supervisor để hai cờ độc lập nhau: supervisorScope vừa
    // là supervisor vừa là scope, và cả hai lý do đều dừng ở đây.
    if (node.isScopeCoroutine) return

    // Supervisor chặn LAN TRUYỀN FAILURE. Nó không nuốt exception — việc đưa
    // exception chưa xử lý tới handler là của scheduler, không phải ở đây.
    if (parent.isSupervisor) return
    if (parent.isCompleted) return

    parent.cause = cause

    // Cancel các con còn lại của parent. cancelJob tự phát CANCEL_REQUESTED
    // ở đầu, nên không phát thêm ở đây kẻo trùng.
    for (const sib of parent.children) {
      if (sib === node || sib.isCompleted) continue
      cancelJob(sib, cause, emitter, parent.id)
    }

    terminateAsFailed(parent, cause, emitter)
    node = parent
  }
}
