import type { JobId, JobState } from '../trace/events'

export interface FailureCause {
  exType: string
  message: string
  isCancellation: boolean
  /** 1-based line of the `throw` statement that caused this, if the original KotlinThrow carried one. */
  line?: number
}

const ALLOWED: Record<JobState, readonly JobState[]> = {
  New: ['Active', 'Cancelling', 'Cancelled'],
  Active: ['Completing', 'Completed', 'Cancelling'],
  Completing: ['Completed', 'Cancelling'],
  Cancelling: ['Cancelled'],
  Completed: [],
  Cancelled: [],
}

export class Job {
  /**
   * Private; can only change via transitionTo. If it were public, every
   * downstream module could assign `job.state = 'Cancelled'` directly,
   * bypassing the very ALLOWED table this class exists to enforce.
   */
  private _state: JobState = 'New'

  /** Why the job ended abnormally, for the trace. Set on BOTH paths: cancelled and failed. */
  cause: FailureCause | null = null

  /**
   * Only set when the job ACTUALLY FAILS — it throws itself, or a child's
   * failure propagates up through it. NOT set when the job is cancelled from
   * outside (user calls cancel(), or it gets dragged down because a sibling
   * failed).
   *
   * This is what distinguishes the two exceptions a coroutine body receives
   * when unwinding, and it is exactly the lesson of this milestone:
   *   - job FAILS        -> the body gets back the EXACT original exception,
   *                          so `coroutineScope { launch { throw RuntimeException } }`
   *                          throws RuntimeException out, just like real Kotlin.
   *   - job is CANCELLED -> the body gets a CancellationException, so an
   *                          innocent bystander coroutine dragged down with
   *                          it does NOT catch someone else's exception by
   *                          mistake.
   * If these were merged into a single `cause`, the two cases would be
   * indistinguishable: the `cause` of a dragged-down sibling would also be
   * the culprit's RuntimeException("boom").
   */
  failure: FailureCause | null = null

  /**
   * The value the coroutine body returns. Only meaningful for async/Deferred:
   * `await()` reads this field. For launch/scope it's still written but
   * nobody reads it — `join()` only waits, it doesn't retrieve a result.
   */
  result: unknown = undefined

  /**
   * The line where this coroutine is CURRENTLY SUSPENDED (`delay`, `await`, `join`).
   *
   * Used to tag the line for this job's OWN cancellation/completion events.
   * Tagging the line of the `throw` that triggered the cancellation chain
   * instead would make every victim point to the same spot, and the cursor
   * in the editor would sit frozen through the whole propagation — measured
   * 18 consecutive steps without moving on the normalfail lesson. What the
   * learner needs to see is where the victim was standing when it got
   * killed: "this coroutine was sitting at delay(500) when it got killed".
   */
  suspendedAtLine: number | undefined = undefined

  /** Array, not a Set — the order must be stable for the trace to be deterministic. */
  private readonly _children: Job[] = []

  /**
   * The Job of a scope builder that runs IN PLACE: coroutineScope /
   * supervisorScope / withContext. The counterpart of `isScopedCoroutine` in
   * kotlinx.
   *
   * The ONLY meaning of this flag: when the job ends abnormally, the
   * exception is RETURNED to the caller's continuation (i.e. thrown right at
   * the call site, catchable by Kotlin's try/catch) instead of cancelling the
   * parent job. kotlinx does exactly this in JobSupport.cancelParent:
   * `if (isScopedCoroutine) return true`.
   *
   * Without this flag, a child's failure climbs straight through the scope up
   * to runBlocking: the trace records the root coroutine as Cancelled while
   * the program keeps running and printing, and the unwind order is
   * reversed — an ancestor's catch runs BEFORE a descendant's finally, the
   * exact opposite of Kotlin.
   *
   * NOT enabled for runBlocking: kotlinx's BlockingCoroutine is not a
   * ScopeCoroutine — it blocks the calling thread rather than returning the
   * exception into a continuation.
   */
  readonly isScopeCoroutine: boolean

  constructor(
    readonly id: JobId,
    readonly name: string,
    readonly parent: Job | null,
    readonly isSupervisor: boolean,
    isScopeCoroutine = false,
  ) {
    this.isScopeCoroutine = isScopeCoroutine
  }

  get state(): JobState { return this._state }

  /** readonly: children must be added via addChild so the link always stays bidirectionally consistent. */
  get children(): readonly Job[] { return this._children }

  get isActive(): boolean { return this._state === 'Active' }
  get isCompleted(): boolean { return this._state === 'Completed' || this._state === 'Cancelled' }
  get isCancelled(): boolean { return this._state === 'Cancelled' }

  /**
   * The parent-child link must be bidirectionally consistent. If it drifts,
   * the child job ends up outside the parent's `children` and gets SKIPPED
   * when cancellation propagates — a silent bug with no error signal. Better
   * to fail fast here than fail silently in Task 13.
   */
  addChild(child: Job): void {
    if (child.parent !== this) {
      throw new Error(
        `Job ${this.id}: addChild(${child.id}) but child.parent does not point back to this job. ` +
        'The parent-child link must be bidirectionally consistent.',
      )
    }
    this._children.push(child)
  }

  transitionTo(next: JobState): void {
    if (!ALLOWED[this._state].includes(next)) {
      throw new Error(`Job ${this.id}: invalid state transition ${this._state} -> ${next}`)
    }
    this._state = next
  }

  /** Depth-first traversal, stable order. */
  descendants(): Job[] {
    const out: Job[] = []
    const walk = (j: Job) => { for (const c of j.children) { out.push(c); walk(c) } }
    walk(this)
    return out
  }
}
