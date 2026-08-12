import type { TraceEmitter } from '../trace/emitter'
import type { JobId } from '../trace/events'
import type { FailureCause, Job } from './job'

/**
 * Cancel propagates DOWN: cancelling a Job drags along every descendant.
 * Idempotent — calling it on an already-completed Job is a no-op.
 */
export function cancelJob(
  job: Job,
  cause: FailureCause,
  emitter: TraceEmitter,
  from: JobId | 'user',
): void {
  if (job.isCompleted) return

  // Children first, in declaration order — this is what makes the trace
  // deterministic. Record this very cancel action BEFORE propagating down.
  // If omitted, the triggering action (user calling job.cancel(), or a
  // parent failure dragging it down) never shows up in the trace, and the
  // UI has nothing to draw at the first step.
  emitter.emit({ k: 'CANCEL_REQUESTED', from, to: job.id, cause: cause.exType },
    job.suspendedAtLine ?? cause.line)

  for (const child of job.children) {
    if (child.isCompleted || child.isNonCancellable) continue
    cancelJob(child, cause, emitter, job.id)
  }

  // Deliberately does NOT carry `causeMessage`: a job cancelled here never
  // actually receives the culprit's exception when unwound — only a
  // synthetic CancellationException (scheduler.ts's unwindCancelled only
  // rethrows `governing.failure`, which cancelJob never sets, unlike
  // terminateAsFailed below). Showing the message here would tell the
  // learner this job saw something it never did.
  const prev = job.state
  if (prev !== 'Cancelling') {
    job.transitionTo('Cancelling')
    emitter.emit({ k: 'JOB_STATE', id: job.id, from: prev, to: 'Cancelling', cause: cause.exType },
      job.suspendedAtLine ?? cause.line)
  }
  job.cause = cause
  job.transitionTo('Cancelled')
  emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType },
    job.suspendedAtLine ?? cause.line)
}

/**
 * Failure propagates UP. Three rules, matching kotlinx.coroutines exactly:
 *
 * 1. CancellationException is normal completion — it does NOT fail the parent.
 * 2. Ordinary parent: fails too, then cancels every remaining sibling.
 * 3. Parent is a supervisor: blocks at the boundary — the parent doesn't
 *    fail, siblings are untouched. (An unhandled exception still goes on to
 *    the handler — that's the scheduler's job, not this one.)
 */
/** Bring a job to an abnormal end state, emitting both JOB_STATE legs. */
function terminateAsFailed(job: Job, cause: FailureCause, emitter: TraceEmitter): void {
  if (job.isCompleted) return
  const prev = job.state
  if (prev !== 'Cancelling') {
    job.transitionTo('Cancelling')
    emitter.emit({ k: 'JOB_STATE', id: job.id, from: prev, to: 'Cancelling', cause: cause.exType, causeMessage: cause.message },
      job.suspendedAtLine ?? cause.line)
  }
  job.cause = cause
  // This is the FAIL path, not the cancel path: the coroutine body must get
  // back the exact original exception when unwinding. cancelJob deliberately
  // does NOT set this field.
  job.failure = cause
  job.transitionTo('Cancelled')
  emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType, causeMessage: cause.message },
    job.suspendedAtLine ?? cause.line)
}

export function reportFailure(child: Job, cause: FailureCause, emitter: TraceEmitter): Job | null {
  child.cause = cause

  // Structured concurrency: a failing coroutine must cancel ITS OWN CHILDREN
  // before it can be considered done — not just siblings at ancestor levels.
  // Skip this step and the children of the failed job keep running freely
  // after their parent is already Cancelled, violating the single most
  // fundamental principle this tool teaches.
  for (const c of child.children) {
    if (c.isCompleted || c.isNonCancellable) continue
    cancelJob(c, cause, emitter, child.id)
  }

  terminateAsFailed(child, cause, emitter)

  if (cause.isCancellation) return null

  // Failure climbs up THROUGH MULTIPLE LEVELS, not just one. If we only
  // notified the direct parent and stopped, then for a tree R -> P -> {A,B,C}
  // of all ordinary Jobs, B failing would kill P and A/C but leave R alive —
  // flat-out wrong compared to Kotlin. It would also drop the
  // FAILURE_PROPAGATED event that reaches a supervisor boundary, which the UI
  // needs to draw the "nested supervisor trap" lesson.
  let node = child
  for (;;) {
    const parent = node.parent
    if (!parent) return node

    // `cause.line` is the line of the `throw` that caused this propagation
    // chain. Tag it onto EVERY event of the chain so the cursor in the
    // editor stays put on the exact faulting line while the failure climbs
    // the tree — instead of leaving it blank and letting the highlighted
    // line get stuck somewhere unrelated from before.
    emitter.emit({
      k: 'FAILURE_PROPAGATED',
      from: node.id,
      to: parent.id,
      blockedBySupervisor: parent.isSupervisor,
    }, cause.line)

    // Scope boundary (coroutineScope/supervisorScope/withContext).
    //
    // The exception REACHES the parent's frame — so FAILURE_PROPAGATED above
    // is still emitted, the UI can still draw the path — but the parent job
    // does NOT die along with it: kotlinx returns the exception into the
    // caller's continuation, so a try/catch around the call site catches it
    // (JobSupport.cancelParent: `if (isScopedCoroutine) return true`).
    // Re-throwing at the call site is done by the interpreter after
    // joinChildren finishes.
    //
    // Placed BEFORE the supervisor branch so the two flags stay independent:
    // supervisorScope is both a supervisor and a scope, and either reason
    // alone stops propagation here.
    if (node.isScopeCoroutine) return null

    // A supervisor blocks FAILURE PROPAGATION. It doesn't swallow the
    // exception — delivering an unhandled exception to the handler is the
    // scheduler's job, not this one.
    if (parent.isSupervisor) return node
    if (parent.isCompleted) return node

    parent.cause = cause

    // Cancel the parent's remaining children. cancelJob already emits
    // CANCEL_REQUESTED at its start, so we don't emit it again here to avoid
    // duplicates.
    for (const sib of parent.children) {
      if (sib === node || sib.isCompleted) continue
      cancelJob(sib, cause, emitter, parent.id)
    }

    terminateAsFailed(parent, cause, emitter)
    node = parent
  }
}
