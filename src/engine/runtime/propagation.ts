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
export function reportFailure(child: Job, cause: FailureCause, emitter: TraceEmitter): void {
  child.cause = cause

  if (!child.isCompleted) {
    const prev = child.state
    if (prev !== 'Cancelling') {
      child.transitionTo('Cancelling')
      emitter.emit({ k: 'JOB_STATE', id: child.id, from: prev, to: 'Cancelling', cause: cause.exType })
    }
    child.transitionTo('Cancelled')
    emitter.emit({ k: 'JOB_STATE', id: child.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType })
  }

  if (cause.isCancellation) return

  const parent = child.parent
  if (!parent) return

  emitter.emit({
    k: 'FAILURE_PROPAGATED',
    from: child.id,
    to: parent.id,
    blockedBySupervisor: parent.isSupervisor,
  })

  if (parent.isSupervisor) return

  parent.cause = cause
  cancelJob(parent, cause, emitter, child.id)
}
