import { TraceEmitter } from '../trace/emitter'
import type { JobId } from '../trace/events'
import { VirtualClock } from './clock'
import { CoroutineContext } from './context'
import { DispatcherPool } from './dispatcher'
import { Job, type FailureCause } from './job'
import { cancelJob, reportFailure } from './propagation'
import type { CoroutineBody, Suspension, VoidCoroutineBody } from './suspension'
import { KotlinThrow } from '../interpreter/values'

interface Task {
  job: Job
  ctx: CoroutineContext
  body: CoroutineBody
  /** Value passed into .next() on the next resume. */
  resumeValue: unknown
  /**
   * When not undefined: the next resume must THROW into the generator
   * instead of calling next(). This second path exists for `await` on a
   * Deferred that already failed — the exception must appear at the exact
   * await point, even when a supervisor has blocked that failure from
   * affecting the scope.
   */
  resumeThrow: unknown
  started: boolean
  /**
   * The line to tag `COROUTINE_STARTED` with — the FIRST line inside the
   * coroutine body, i.e. where it actually starts running, not the line that
   * wrote `launch`.
   */
  startLine: number | undefined
  /**
   * The line of the suspend point currently pending. `COROUTINE_RESUMED`
   * tags this line, because resuming means running on FROM THERE. Without
   * it, every RESUMED carries no line at all, and the cursor in the editor
   * sits frozen through long stretches — measured 16 consecutive steps with
   * no line change on the scopecompare lesson.
   */
  resumeLine: number | undefined
  /** Has finished running or has unwound — the generator must not be touched again. */
  finished: boolean
  /**
   * The cancellation signal has already been thrown into this generator, but
   * it has NOT finished running yet.
   *
   * Exists because unwinding is no longer always synchronous: a generator
   * can CATCH the cancellation signal and then suspend again at a different
   * point — `runInlineBody` catches it and then does `yield joinChildren` to
   * wait for the scope's children to finish running their `finally` — so
   * `body.throw()` RETURNS an IteratorResult instead of throwing, and the
   * task still needs to keep running.
   *
   * Used for EXACTLY ONE purpose: opening the `job.isCompleted` gate at the
   * top of `step()`. The job was already Cancelled before the signal was
   * thrown in, so without this flag the next resume would be blocked by that
   * gate, the generator would be abandoned mid-flight, `finished` would
   * never be set, and whoever `join()`s it would hang forever.
   *
   * DELIBERATELY NOT used to guard against throwing twice: Kotlin throws
   * CancellationException at EVERY suspend point of a cancelled coroutine,
   * not just the first one. The guard against throwing twice applies only to
   * an inline scope's `joinChildren` — see `isWaitingForScopeChildren`.
   */
  unwinding: boolean
  /**
   * Inline scopes (runBlocking/coroutineScope/supervisorScope/withContext)
   * run inside the OUTER task's generator, so `currentJob` — which is
   * assigned from task.job at the top of every step() — is not the job
   * actually executing. This stack holds the inline job scoped to THIS TASK
   * ALONE, and every event emitted on behalf of "the current job" must read
   * through here.
   *
   * Kept on Task, not on Scheduler: a task can be suspended in the middle of
   * an inline scope's body (`coroutineScope { delay(100) }`) while another
   * task runs. A stack shared at the Scheduler level would assign the
   * suspended task's inline job to the running task's `println` — a silent
   * bug that only shows up once two coroutines interleave.
   */
  inlineStack: Job[]
  /**
   * The parent's dispatcher AT CREATION TIME, or null if there is no parent.
   *
   * Captured instead of reading the parent task's `ctx` when needed: since
   * `switchContext` exists, `task.ctx` is MUTABLE data — the parent could be
   * in the middle of a `withContext(IO)` by the time the child first runs,
   * and comparing against the parent's current ctx at that point would
   * swallow a real DISPATCH. Kotlin dispatches the child's first
   * continuation right at the `launch` call site (CoroutineStart.DEFAULT),
   * so the correct baseline for comparison is the dispatcher AT CREATION.
   */
  parentDispatcher: string | null
}

export function toCause(err: unknown): FailureCause {
  // Identified by shape, not `instanceof KotlinThrow`: the Scheduler's tests
  // build fake exceptions with Object.assign(new Error, { kotlinType }), and
  // the Scheduler has no reason to depend on the interpreter's concrete
  // class.
  if (err && typeof err === 'object' && 'kotlinType' in err) {
    const e = err as { kotlinType: string; kotlinMessage?: string; message?: string; line?: number }
    return {
      exType: e.kotlinType,
      // Prefer kotlinMessage. KotlinThrow's Error.message is built as
      // `${kotlinType}: ${kotlinMessage}`, so reading the wrong one doubles
      // up the type name: `catch (e: RuntimeException) { println(e.message) }`
      // would print "RuntimeException: boom" instead of "boom".
      message: e.kotlinMessage ?? e.message ?? '',
      isCancellation: e.kotlinType === 'CancellationException',
      // Duck-typed (not instanceof), same as the rest of this function — the
      // Scheduler's tests build fake errors with Object.assign and don't
      // carry a `line`, so reading undefined via optional chaining is
      // correct, not a bug.
      line: e.line,
    }
  }
  return { exType: 'Exception', message: String(err), isCancellation: false }
}

/**
 * An ENGINE error, not an exception from the Kotlin program being run: an
 * invariant has broken and there is no sensible way to "keep going".
 *
 * Identified by shape, not `instanceof KotlinThrow`, for exactly the same
 * reason (and the same technique) as `toCause`: the Scheduler's tests build
 * fake Kotlin exceptions with `Object.assign(new Error, { kotlinType })`, and
 * those must be treated as exceptions from the program.
 *
 * The interpreter's `ReturnSignal` is NOT an Error, so it never reaches this
 * check — it's an internal control signal and keeps its existing handling
 * path.
 */
function isEngineError(err: unknown): boolean {
  return err instanceof Error && !('kotlinType' in err)
}

export class Scheduler {
  readonly emitter = new TraceEmitter()
  readonly clock = new VirtualClock()
  readonly pool = new DispatcherPool()

  private nextJobId = 1
  private readonly ready: Task[] = []
  private readonly tasks = new Map<JobId, Task>()
  /** Parallel array to `tasks`, to iterate in creation order. */
  private readonly taskOrder: Task[] = []
  private currentJob: Job | null = null
  /**
   * The task whose generator is running RIGHT NOW. Travels together with
   * `currentJob` and is always set/cleared at the same time as it; kept
   * separate because the inline scope stack lives on Task.
   */
  private currentTask: Task | null = null
  /** The root coroutine. The program ends when it ends — see runToCompletion. */
  private rootJobId: JobId | null = null
  /**
   * A task that just went through `switchContext` and is waiting to be run
   * again on the new dispatcher, along with the job that should be named in
   * the DISPATCH event and the line that caused it. DISPATCH can't be
   * emitted right inside `suspend()`: the threadId is only known after
   * `acquire` on the next step.
   */
  private readonly pendingDispatch = new Map<Task, { jobId: JobId; line?: number }>()

  /**
   * Tasks waiting for another job to finish. An array, not a nested Map, so
   * wake-up order stays stable — that is a precondition for a deterministic
   * trace.
   *
   * MUST NOT be implemented as waiting by re-scheduling itself at the same
   * point in time: doing so would mean `ready` is never empty, the virtual
   * clock never advances, and everything freezes. A waiter must sit OUTSIDE
   * `ready` until its condition is met.
   */
  private waiters: { task: Task; kind: 'join' | 'await' | 'children'; targetId: JobId }[] = []

  private newJobId(): JobId { return `j${this.nextJobId++}` }

  /**
   * The job that the currently running code BELONGS TO, which differs from
   * `currentJob` (the task's job). In `withContext(Dispatchers.IO) { println("x") }`,
   * the task that's running is still runBlocking's task, but that println
   * line belongs to the withContext job — that's what the graph must
   * highlight. Every event emitted on behalf of "the current job" must read
   * through here, not through `currentJob`.
   */
  private get currentInlineJob(): Job | null {
    const t = this.currentTask
    return t ? (t.inlineStack[t.inlineStack.length - 1] ?? t.job) : this.currentJob
  }

  /** The REAL dispatcher of the running task — accounting for nested withContext calls. */
  currentDispatcher(): string {
    if (!this.currentTask) {
      // No task running means no dispatcher is "in effect". Returning some
      // arbitrary 'Default' here would make the interpreter think a
      // dispatcher switch happened and emit a bogus DISPATCH; better to die
      // immediately than build a wrong trace.
      throw new Error('Scheduler: currentDispatcher() called outside of running a task')
    }
    return this.currentTask.ctx.dispatcher
  }

  /** The effective dispatcher of an existing job (its ctx already merged with its parent's). */
  dispatcherOf(jobId: JobId): string {
    const task = this.tasks.get(jobId)
    if (!task) throw new Error(`Scheduler: no task for job ${jobId}`)
    return task.ctx.dispatcher
  }

  println(text: string, srcLine?: number): void {
    this.emitter.emit({ k: 'PRINTLN', id: this.currentInlineJob?.id ?? 'j0', text }, srcLine)
  }

  /**
   * A `catch` just matched. Emitted by the interpreter, same path as `println`.
   *
   * EXCEPTION_CAUGHT exists in events.ts and has had a narration string
   * since M1, but NOTHING was emitting it — so the two lessons that live off
   * this exact moment (`exception`: catching it means the job doesn't fail;
   * `swallow`: a broad catch also swallows the cancellation signal) only ever
   * showed an EXCEPTION_THROWN and then went silent, with nothing on the
   * graph saying it had been handled. The learner had to infer it purely
   * from "the job isn't red".
   */
  exceptionCaught(exType: string, srcLine?: number): void {
    this.emitter.emit(
      { k: 'EXCEPTION_CAUGHT', id: this.currentInlineJob?.id ?? 'j0', exType }, srcLine)
  }

  spawnRoot(makeBody: (job: Job) => CoroutineBody): Job {
    const job = this.spawn(
      null, false, 'runBlocking', CoroutineContext.empty().withDispatcher('Main'), makeBody)
    this.rootJobId = job.id
    return job
  }

  /** Convenience for the Scheduler's own unit tests; the interpreter uses spawnChildOf. */
  spawnChild(makeBody: (job: Job) => CoroutineBody, builder: 'launch' | 'async' = 'launch'): Job {
    const parent = this.currentJob
    const ctx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    return this.spawn(parent, false, builder, ctx, makeBody)
  }

  /**
   * `makeBody` receives the Job that was just created, so the coroutine body
   * knows its own jobId without needing an intermediate variable (Task 16
   * uses this to build a child Env scoped correctly).
   */
  spawn(
    parent: Job | null,
    isSupervisor: boolean,
    builder: 'launch' | 'async' | 'runBlocking' | 'coroutineScope' | 'supervisorScope' | 'withContext',
    ctx: CoroutineContext,
    makeBody: (job: Job) => CoroutineBody,
    srcLine?: number,
    startLine?: number,
    varName?: string,
  ): Job {
    const id = this.newJobId()
    const job = new Job(id, ctx.name ?? id, parent, isSupervisor)
    parent?.addChild(job)

    const jobCtx = ctx.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
      ...(varName === undefined ? {} : { varName }),
    }, srcLine)
    // CoroutineStart.DEFAULT (the ONE path this subset supports, see spec
    // §4.1): real Kotlin treats a freshly created coroutine as Active
    // IMMEDIATELY — `New` only exists for CoroutineStart.LAZY, outside this
    // subset. `launch`/`async` return synchronously, so any statement
    // between the call and the next suspend point must see Active, not New.
    // Verified against real Kotlin (api.kotlinlang.org 2.1.20):
    // `val job = launch { delay(10) }; println(job.isActive)` prints "true".
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })

    const task: Task = {
      job, ctx: jobCtx, body: makeBody(job), resumeValue: undefined, resumeThrow: undefined,
      started: false, finished: false, unwinding: false, inlineStack: [],
      startLine: startLine ?? srcLine, resumeLine: undefined,
      parentDispatcher: parent ? this.tasks.get(parent.id)?.ctx.dispatcher ?? null : null,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    this.ready.push(task)
    return job
  }

  jobById(id: JobId | null): Job | null {
    return id ? this.tasks.get(id)?.job ?? null : null
  }

  /**
   * "Done" in the sense that a WAITER cares about: the state has reached an
   * end state AND the coroutine body has finished unwinding.
   *
   * Checking `job.isCompleted` alone is not enough. cancelJob flips
   * Active->Cancelling->Cancelled straight through in ONE synchronous call,
   * so no job ever REMAINS at Cancelling: right after `j.cancel()`, j is
   * already isCompleted while its generator is still suspended at a suspend
   * point and its `finally` block hasn't run yet. Waking a waiter at that
   * point would let `j.join()` return BEFORE j finishes cleaning up — Kotlin
   * gives ["cleanup", "done"], the old engine gave ["done", "cleanup"].
   *
   * `!task.started` is the cancelled-before-it-ran case: there's nothing to
   * unwind, so it's done immediately. Without this branch, unwindCancelled
   * (which skips tasks that never started) would never set `finished`, and a
   * waiter would hang forever.
   */
  private isJobSettled(id: JobId): boolean {
    const task = this.tasks.get(id)
    if (!task) return true
    if (!task.job.isCompleted) return false
    return task.finished || !task.started
  }

  /**
   * Wake any waiter whose condition is now satisfied. Preserves registration order.
   * Returns true if any waiter was moved into ready.
   */
  private sweepWaiters(): boolean {
    const still: typeof this.waiters = []
    let woke = false
    for (const w of this.waiters) {
      const done = w.kind === 'children'
        ? (this.tasks.get(w.targetId)?.job.children.every(c => this.isJobSettled(c.id)) ?? true)
        : this.isJobSettled(w.targetId)
      if (!done) { still.push(w); continue }
      // Shares wakeAwaiter with the isJobSettled branch in suspend(). If the
      // two ever drift apart, "does await throw or not" would depend on
      // whether the Deferred settled before or after await was called —
      // wrong in a randomly-timed way.
      if (w.kind === 'await') this.wakeAwaiter(w.task, w.targetId)
      else this.ready.push(w.task)
      woke = true
    }
    this.waiters = still
    return woke
  }

  /**
   * Wake a task that's waiting on `await` for `targetId`.
   *
   * `join` and `await` differ EXACTLY here: join just waits, await READS the
   * result — so await must re-throw the Deferred's failure at the exact
   * await point, even when a supervisor has already blocked that failure
   * from affecting the scope. That's why `join()` on an already-failed
   * Deferred silently continues, while `await()` throws.
   *
   * Two throw paths, matching kotlinx:
   *   - Deferred FAILED    -> re-throw the EXACT original exception (`failure`).
   *   - Deferred CANCELLED from outside -> `failure` is null but await must
   *     still throw CancellationException. Verified against real Kotlin:
   *     `d.cancel()` then `d.await()` prints "DeferredCoroutine was cancelled",
   *     NOT Unit. Without this branch, `println(d.await())` on a cancelled
   *     Deferred prints "kotlin.Unit" and the program keeps going — a silent
   *     bug, exactly the class of bug this task fixes.
   * Only when the Deferred finishes NORMALLY does it return a value.
   */
  private wakeAwaiter(task: Task, targetId: JobId): void {
    const target = this.tasks.get(targetId)?.job ?? null
    // `cause` is only read once the job has actually been cancelled: a job
    // that finished normally has no cause, and a job dragged down because a
    // sibling failed has a cause that's someone else's exception — but it
    // WAS cancelled, so it still must throw rather than return a value.
    const thrown = target?.failure ?? (target?.isCancelled ? target.cause : null)
    if (thrown) {
      task.resumeThrow = new KotlinThrow(thrown.exType, thrown.message)
    } else if (target?.isCancelled) {
      // Cancelled but nobody recorded a cause (cancelled before it got a
      // chance to run, for instance). Same synthetic exception unwindCancelled
      // uses, so the two paths stay consistent.
      task.resumeThrow = new KotlinThrow('CancellationException', 'Job was cancelled')
    } else {
      task.resumeValue = target?.result
    }
    this.ready.push(task)
  }

  /** Run until no task is ready, no waiter is satisfied, and no timer remains. */
  runToCompletion(): void {
    let guard = 0
    for (;;) {
      // Count on the OUTER loop too, not just the `ready` loop. Now that the
      // cancellation signal is re-thrown at every suspend point (matching
      // Kotlin), a coroutine body like
      // `while (true) { try { delay(1) } catch (e: CancellationException) { } }`
      // cycles through unwindCancelled WITHOUT ever touching `ready` — a
      // guard only on the inner loop would hard-freeze the browser instead
      // of reporting an error.
      if (++guard > 100_000) throw new Error('Scheduler: suspected infinite loop')
      while (this.ready.length > 0) {
        if (++guard > 100_000) throw new Error('Scheduler: suspected infinite loop')
        this.step(this.ready.shift()!)
      }
      // Let an already-cancelled coroutine finish running its finally before
      // advancing the clock. Placed before sweepWaiters so finally isn't
      // deferred by yet another loop iteration.
      if (this.unwindCancelled()) continue
      // Sweep waiters AFTER ready has drained, not after every step. A job
      // that just finished may have unblocked a waiter; skip this line and
      // the clock would jump right past work that was already ready to run.
      // Sweeping on every step would be both redundant and wasteful.
      if (this.sweepWaiters()) continue
      // The program ENDS when the root coroutine ends, exactly like the JVM
      // exits the instant `main` returns and kills every daemon thread.
      //
      // Without this gate, runToCompletion would drain EVERY timer, so a
      // GlobalScope coroutine (which has escaped the job tree — nobody is
      // waiting on it) would keep printing after the program should already
      // be done — teaching the wrong half of the "GlobalScope escapes
      // structured concurrency" lesson: once it escapes, it must NOT
      // outlive the program either.
      //
      // Placed AFTER unwindCancelled and sweepWaiters, not before: when the
      // root FAILS, its task finishes right inside step() while a child that
      // was just cancelled hasn't unwound yet. Gating any earlier would
      // swallow their `finally` — in Kotlin, runBlocking waits for children
      // to finish unwinding before throwing outward. Measured: moving this
      // gate before unwindCancelled turns the test 'root FAIL still lets
      // children finish their finally' RED ([] instead of ['cleanup']).
      //
      // DELIBERATELY does not emit a synthetic cancel for coroutines left
      // behind: the JVM kills daemon threads WITHOUT unwinding them, so
      // fabricating a Cancelled would run their `finally` — a different kind
      // of wrong. The trace leaves them sitting at COROUTINE_SUSPENDED with
      // no resume, exactly what really happened.
      if (this.rootJobId !== null && this.isJobSettled(this.rootJobId)) break
      this.emitter.setClock(this.clock.now)
      if (!this.clock.advanceToNextTimer()) break
      this.emitter.setClock(this.clock.now)
      // No re-sweep of waiters here: a timer's callback only pushes a task
      // into ready, it doesn't change any job's state, so no waiter could
      // have just been unblocked.
    }
  }

  /**
   * Throw CancellationException into coroutines that have already been
   * cancelled but are still suspended at a suspend point, so that `finally`
   * blocks in the Kotlin code actually run.
   *
   * Without this step, cancelJob only flips the Job's state: the generator
   * is never resumed, so every finally block silently fails to run — exactly
   * what choosing generators was supposed to give us for free (see spec §2.3).
   *
   * Returns true if anything unwound, so runToCompletion loops again before
   * advancing the clock.
   */
  private unwindCancelled(): boolean {
    let did = false
    for (const task of this.taskOrder) {
      if (task.finished || !task.started) continue
      const governing = this.governingJob(task)
      if (!governing.isCancelled) continue
      if (this.isWaitingForScopeChildren(task, governing)) continue

      // Do NOT set `finished` here. Unwinding can span multiple scheduler
      // turns (see `Task.unwinding`), and `finished` is what `isJobSettled`
      // reads to answer "has cleanup finished" — setting it early would wake
      // a waiter before `finally` has had a chance to run.
      task.unwinding = true
      did = true
      this.currentJob = task.job
      // The inline stack is still intact from when the task was suspended:
      // `finally` running on the unwind path, if it's INSIDE some inline
      // scope, belongs to that scope, exactly like during normal execution.
      this.currentTask = task
      let result: IteratorResult<Suspension, unknown> | null = null
      try {
        // The generator runs any finally blocks on the unwind path and then re-throws.
        //
        // A FAILED job must get back the EXACT original exception, not a
        // synthetic CancellationException. If we always threw the synthetic
        // one, `try { coroutineScope { launch { throw RuntimeException("boom") } } }
        //  catch (e: RuntimeException) { ... }` would never match, and the
        // learner would see "Job was cancelled" exactly where real Kotlin
        // gives "boom" — i.e. the tool would teach the opposite of the very
        // distinction it exists to teach.
        // A job CANCELLED from outside has `failure` as null and still gets
        // CancellationException, matching Kotlin.
        const f = governing.failure
        result = task.body.throw(f
          ? new KotlinThrow(f.exType, f.message)
          : new KotlinThrow('CancellationException', 'Job was cancelled'))
      } catch (err) {
        // The generator re-throws the KOTLIN exception after finally has
        // finished running — normal, not a bug, correctly swallowed here.
        //
        // But a BARE `catch` would also swallow the engine's own invariant
        // errors thrown from a `finally` mid-unwind — including "inline
        // stack mismatch". That check exists to fail loudly; swallowed here,
        // it becomes decorative, and an internal exception would even
        // REPLACE the in-flight CancellationException without leaving a trace.
        if (isEngineError(err)) throw err
        // Reaching here means the generator has FINISHED unwinding.
        task.finished = true
        task.unwinding = false
      } finally {
        this.currentJob = null
        this.currentTask = null
      }
      if (result === null) continue
      // Reaching here means `body.throw()` RETURNED instead of throwing: the
      // generator caught the cancellation signal and still has work to do.
      // Abandoning it here would drop every `finally` past the catch point —
      // exactly what choosing generators was supposed to give us for free.
      // Hand it back to the scheduler's normal run path.
      if (result.done) this.completeTask(task, result.value)
      else this.suspend(task, result.value)
    }
    return did
  }

  /**
   * Which job actually governs whether this task keeps being allowed to run.
   *
   * Not always `task.job`: while a task is suspended in the middle of an
   * inline scope's body (`coroutineScope { delay(1000) }`), that body
   * belongs to the scope's job, and that job is exactly the one that gets
   * cancelled when one of the scope's children fails. This used to only look
   * at `task.job`, so the cancellation signal never arrived: the scope's job
   * changed state correctly, but its "task" is an empty generator that never
   * ran, while the real generator belongs to the parent task — and the
   * parent wasn't cancelled.
   */
  private governingJob(task: Task): Job {
    return task.inlineStack[task.inlineStack.length - 1] ?? task.job
  }

  /**
   * Whether a task is parked at `joinChildren` for the SAME inline scope
   * currently governing it — i.e. that scope already KNOWS it's broken and
   * is waiting for its children to finish running `finally` before
   * re-throwing at the caller's frame (`runInlineBody`, both the normal path
   * and the `catch` path). This is the "don't throw a second time for the
   * same job" guard: the cancellation signal is already inside the
   * generator, and throwing again would land right on that pending `yield
   * joinChildren` and CUT THE WAIT SHORT — the caller's `catch` would run
   * before the children finished cleaning up, exactly bug R1 that M1 already
   * fixed once.
   *
   * Reads straight from `waiters` instead of keeping a parallel flag on
   * Task: `waiters` is a COMPLETE description of "parked at joinChildren" at
   * this moment, because `unwindCancelled` only ever runs once `ready` has
   * drained (see runToCompletion) — no task can have just been woken without
   * having had a chance to run yet. A parallel flag would go stale on
   * exactly the paths nobody remembers to update.
   *
   * `inlineStack.length > 0` is a real condition, not decoration: every
   * launch/async/root body ends with a `joinChildren` for its OWN job.
   * Without it, a launch cancelled from outside while waiting for its
   * children would never receive the cancellation signal, and whoever
   * `join()`s it would hang forever.
   */
  private isWaitingForScopeChildren(task: Task, governing: Job): boolean {
    if (task.inlineStack.length === 0) return false
    return this.waiters.some(
      w => w.task === task && w.kind === 'children' && w.targetId === governing.id)
  }

  private step(task: Task): void {
    const { job } = task
    // `task.unwinding` is a deliberate exception to the "job is already done,
    // so stop" gate: a generator that is CURRENTLY unwinding still has
    // `finally` blocks to run and a tail (`joinChildren` waiting for
    // children to clean up) to finish, even though its job was already
    // Cancelled before the cancellation signal was thrown in. Gating here
    // would abandon the generator mid-flight: `finally` wouldn't run,
    // `finished` would never be set, and whoever `join()`s it would hang
    // forever.
    if (job.isCompleted && !task.unwinding) return

    const acquired = this.pool.acquire(task.ctx.dispatcher, job.id)
    if (acquired === null) {
      // MUST NOT fabricate a thread id here. A subsequent release() would
      // free the thread with that made-up id — which could be busy running a
      // different job — corrupting the pool's state and producing a
      // THREAD_STATE 'FREE' for a thread that's actually still running. In
      // M1 the scheduler runs tasks strictly one at a time, so the pool
      // never runs dry; if it does, an invariant has broken and we must die
      // immediately rather than corrupt state silently.
      throw new Error(
        `Scheduler: pool '${task.ctx.dispatcher}' ran out of threads while running ${job.id}. ` +
        'The "only one task runs per turn" invariant has been broken.',
      )
    }
    const threadId = acquired
    this.currentJob = job
    this.currentTask = task

    // DISPATCH means a dispatcher CHANGE, not "was scheduled". Emitted when:
    //  - a task just went through switchContext (withContext changing dispatcher), or
    //  - the first run of a coroutine whose dispatcher differs from its parent's.
    // Emitting it on every acquire would duplicate COROUTINE_STARTED/RESUMED
    // and completely lose the meaning of "this is where the thread changed".
    //
    // Must come BEFORE the `task.started = true` block below: the first-run
    // condition reads that very flag.
    const pending = this.pendingDispatch.get(task)
    this.pendingDispatch.delete(task)
    if (pending) {
      this.emitter.emit(
        { k: 'DISPATCH', id: pending.jobId, dispatcher: task.ctx.dispatcher, threadId },
        pending.line)
    } else if (!task.started && task.parentDispatcher !== null
               && task.parentDispatcher !== task.ctx.dispatcher) {
      this.emitter.emit({ k: 'DISPATCH', id: job.id, dispatcher: task.ctx.dispatcher, threadId })
    }

    if (!task.started) {
      // `New -> Active` no longer happens here as of Task 19: the job is
      // already Active the instant `spawn`/`spawnChildOf` creates it
      // (matching real Kotlin's CoroutineStart.DEFAULT). This spot now only
      // marks the start of EXECUTION — COROUTINE_STARTED is a run-time
      // event, distinct from Active, which is a lifecycle state; `task.started`
      // and this event are deliberately kept right where they were, not
      // moved to track Active.
      task.started = true
      this.emitter.emit({ k: 'COROUTINE_STARTED', id: job.id, threadId }, task.startLine)
    } else {
      this.emitter.emit({ k: 'COROUTINE_RESUMED', id: job.id, threadId }, task.resumeLine)
    }
    this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'RUNNING' })

    let result: IteratorResult<Suspension, unknown>
    try {
      // Two resume paths. The `throw` path is for `await` on a Deferred that
      // already failed: the exception must surface FROM INSIDE the
      // generator, at the exact line that called await, so that Kotlin
      // code's try/catch around that spot catches it. Clear both fields
      // BEFORE calling, or a later resume would reuse a stale value.
      const thrown = task.resumeThrow
      const resumed = task.resumeValue
      task.resumeThrow = undefined
      task.resumeValue = undefined
      result = thrown !== undefined ? task.body.throw(thrown) : task.body.next(resumed)
    } catch (err) {
      task.finished = true
      // The exception has left the generator: if this was the tail of an
      // unwind, that unwind ends right here.
      task.unwinding = false
      this.pool.release(threadId)
      this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
      this.currentJob = null
      this.currentTask = null
      // Same reason (and same guard) as failInline: if the job has ALREADY
      // finished, this isn't a new failure, just the same exception
      // continuing to unwind back out through its frame. Recording it again
      // would duplicate the event — and worse, emit EXCEPTION_THROWN for a
      // job the trace has just declared dead.
      //
      // job.isCompleted HERE differs from the check at the top of step(): it
      // may have just transitioned to a terminal state WHILE body.next() was
      // running, because the body's own failure propagated up through this
      // very job.
      if (job.isCompleted) return
      const cause = toCause(err)
      this.emitter.emit(
        { k: 'EXCEPTION_THROWN', id: job.id, exType: cause.exType, message: cause.message }, cause.line)
      reportFailure(job, cause, this.emitter)
      return
    }

    this.pool.release(threadId)
    this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
    this.currentJob = null
    this.currentTask = null

    if (result.done) {
      this.completeTask(task, result.value)
      return
    }

    this.suspend(task, result.value)
  }

  /**
   * The task's generator has finished running: record the result and close out the job.
   *
   * Shared by both paths that reach this destination — `step()` (the normal
   * path) and `unwindCancelled` (the generator caught the cancellation
   * signal and ran on to completion). Two copies of this block would drift
   * apart, and the drift would be silent: forget `job.result` and `await`
   * reads undefined; forget the state transition and the job sits at Active
   * forever in the trace.
   */
  private completeTask(task: Task, value: unknown): void {
    const { job } = task
    task.finished = true
    task.unwinding = false
    // Store BEFORE transitioning state: waiters are woken based on state, so
    // writing this after could let await read a still-empty result.
    job.result = value
    if (!job.isCompleted) {
      job.transitionTo('Completing')
      this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Active', to: 'Completing' })
      job.transitionTo('Completed')
      this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Completing', to: 'Completed' })
    }
  }

  private suspend(task: Task, s: Suspension): void {
    // `switchContext` is a TECHNICAL yield point (the old thread must be
    // released before the new one can be acquired), NOT a suspend point the
    // learner needs to see the way delay/await/join are. Kotlin doesn't
    // treat withContext as a suspend point of the calling coroutine in that
    // sense either. Emitting COROUTINE_SUSPENDED here would inject an extra
    // suspended/resumed pair into the timeline for EVERY dispatcher-changing
    // withContext, drowning out the exact thing the lesson wants to
    // highlight: where the thread changed.
    if (s.s !== 'switchContext') {
      // 'joinChildren' isn't part of the Event schema — collapse it to 'join' when recording the trace.
      const reason = s.s === 'joinChildren' ? 'join' : s.s
      this.emitter.emit({ k: 'COROUTINE_SUSPENDED', id: task.job.id, reason }, s.line)
    }
    // Remember where it's suspended so the next resume points back here
    // correctly. `joinChildren` is generated by the builder itself and
    // carries no line — KEEP the old value instead of overwriting it with
    // undefined, otherwise resuming after a joinChildren would lose the line.
    if (s.line !== undefined) {
      task.resumeLine = s.line
      task.job.suspendedAtLine = s.line
    }

    switch (s.s) {
      case 'delay':
        this.clock.schedule(this.clock.now + s.ms, () => { this.ready.push(task) })
        break
      case 'yield':
        this.ready.push(task)
        break
      case 'join': {
        // Same condition as sweepWaiters — if the two ever drift apart,
        // whether join() returns immediately or has to wait would depend on
        // random timing.
        if (this.isJobSettled(s.jobId)) { this.ready.push(task); break }
        this.waiters.push({ task, kind: 'join', targetId: s.jobId })
        break
      }
      case 'await': {
        // Differs from 'join' in exactly one place: await reads the result,
        // so it goes through wakeAwaiter. A Deferred that already settled
        // must also go through that path — if this used ready.push like
        // join, an `await` on a Deferred that failed early would silently
        // return Unit, while the exact same code with a Deferred that failed
        // late would throw.
        if (this.isJobSettled(s.jobId)) { this.wakeAwaiter(task, s.jobId); break }
        this.waiters.push({ task, kind: 'await', targetId: s.jobId })
        break
      }
      case 'joinChildren': {
        const target = this.tasks.get(s.jobId)
        if (!target || target.job.children.every(c => this.isJobSettled(c.id))) {
          this.ready.push(task); break
        }
        this.waiters.push({ task, kind: 'children', targetId: s.jobId })
        break
      }
      case 'switchContext': {
        task.ctx = task.ctx.withDispatcher(s.dispatcher)
        // The old thread was already released at the end of step(); the new
        // thread will be acquired on the next step. DISPATCH must carry the
        // NEW threadId, which is only known after acquire — so record it as
        // owed here, and pay it off at the top of the next step().
        this.pendingDispatch.set(task, { jobId: s.jobId, line: s.line })
        this.ready.push(task)
        break
      }
    }
  }

  cancel(job: Job, cause: FailureCause): void {
    cancelJob(job, cause, this.emitter, 'user')
  }

  /**
   * launch/async: creates a child under `parentJobId` (taken from Env, NOT
   * from currentJob — see the note in Env), which runs later, appended to
   * the end of the ready queue.
   *
   * A parent that has ALREADY FINISHED is a special case: the child is still
   * CREATED (it's a real Job — `isCancelled` reads correctly on it) but is
   * cancelled immediately and NEVER enters the ready queue, so its body
   * never runs at all. Verified against real Kotlin (2.1.20):
   *
   *   val scope = CoroutineScope(Job()); scope.cancel()
   *   val j = scope.launch { println("BODY"); ... finally { println("FINALLY") } }
   *   -> isCancelled=true, isActive=false, and NOTHING is printed — neither
   *      BODY nor FINALLY. A body that never started has nothing to unwind.
   *      (This is exactly why Kotlin needs withContext(NonCancellable) for
   *      cleanup work.)
   *
   * Without this guard, the trace would produce an IMPOSSIBLE shape: a
   * 'Cancelled' parent node containing a 'Completed' child node. That door
   * only opened once spawnScopeRoot existed — before that, no job could die
   * while code was still spawning children under it, because `scope.cancel()`
   * couldn't have cancelled anything yet.
   *
   * Also correct for `finally { launch { } }` inside a coroutine that's
   * already being cancelled: the parent is already Cancelled, so the new
   * child simply never runs — exactly like Kotlin.
   */
  spawnChildOf(
    parentJobId: JobId | null,
    ctx: CoroutineContext,
    builder: 'launch' | 'async',
    varName: string | undefined,
    makeBody: (job: Job) => CoroutineBody,
    srcLine?: number,
    startLine?: number,
  ): Job {
    const parent = this.jobById(parentJobId)
    const parentCtx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    const job = this.spawn(parent, false, builder, parentCtx.plus(ctx), makeBody, srcLine, startLine, varName)
    if (parent?.isCompleted) {
      // Pull it out of ready AFTER spawn, rather than adding a flag to spawn:
      // COROUTINE_CREATED must still be emitted normally (the child does
      // exist — Kotlin returns a readable Job), only RUNNING doesn't happen.
      // Found by identity, not assumed to be the last element.
      const i = this.ready.findIndex(t => t.job === job)
      if (i >= 0) this.ready.splice(i, 1)
      // A synthetic CancellationException, NOT `parent.cause`. Measured:
      // `scope.async { }.await()` on an already-cancelled scope throws
      // JobCancellationException, not a re-throw of whatever originally
      // killed the scope. Using parent.cause here would make wakeAwaiter
      // throw someone else's exception at the await point — a subtle bug.
      cancelJob(job, {
        exType: 'CancellationException', message: 'Job was cancelled', isCancellation: true,
      }, this.emitter, parent.id)
    }
    return job
  }

  /**
   * coroutineScope/supervisorScope/runBlocking/withContext: creates a Job in
   * the tree, but the body runs right here, not queued separately.
   */
  spawnInline(
    builder: 'runBlocking' | 'coroutineScope' | 'supervisorScope' | 'withContext',
    parentJobId: JobId | null,
    isSupervisor: boolean,
    ctx: CoroutineContext,
  ): Job {
    const parent = this.jobById(parentJobId)
    const parentCtx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    const merged = parentCtx.plus(ctx)
    const id = this.newJobId()
    // runBlocking is NOT a scope coroutine: kotlinx's BlockingCoroutine
    // blocks the calling thread rather than returning the exception into a
    // continuation. See Job.isScopeCoroutine.
    const job = new Job(id, merged.name ?? id, parent, isSupervisor, builder !== 'runBlocking')
    parent?.addChild(job)
    const jobCtx = merged.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
    })
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })
    const task: Task = {
      job, ctx: jobCtx, body: (function* (): VoidCoroutineBody { })(), resumeValue: undefined,
      resumeThrow: undefined, started: true, finished: false, unwinding: false, inlineStack: [],
      startLine: undefined, resumeLine: undefined,
      parentDispatcher: parentCtx.dispatcher,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    // Do NOT push onto the inline stack here. CREATING the job and ENTERING
    // the scope are two different moments: between them, withContext still
    // yields a dispatcher-switch point, and the task could be cancelled
    // right at that point. Pushing here would put that push OUTSIDE the
    // try/finally that owns the matching pop, so that cancellation would
    // leak a job off the stack. The caller must call `enterInline`
    // themselves as the first statement, inside the very same try that has
    // `exitInline` in its finally.
    return job
  }

  /**
   * The ROOT job representing a `CoroutineScope(ctx)`. No parent, no
   * generator body, never enters the ready queue — it's purely a structural
   * anchor so `scope.launch` has a real parent, and so a SupervisorJob has
   * somewhere to block failure.
   *
   * Does not auto-Complete: in Kotlin, a user-built scope lives until it's
   * cancelled. It ends when `scope.cancel()` is called, or never.
   *
   * DIFFERS from spawnInline in two deliberate ways:
   *   - `parent` is always null. `CoroutineScope(ctx)` does NOT hang beneath
   *     the surrounding coroutine — that's exactly why it escapes the
   *     caller's structured concurrency, and it's the first half of the lesson.
   *   - the task has `finished: true` from the start. There's no generator
   *     to run, so there's nothing to unwind: `unwindCancelled` must SKIP it
   *     (otherwise `scope.cancel()` would call `.throw()` into an empty
   *     generator, burning a loop iteration with no event produced), while
   *     `isJobSettled` falls back to the only question that means anything
   *     for this job: has the state reached an end state.
   */
  spawnScopeRoot(ctx: CoroutineContext, isSupervisor: boolean, varName?: string): Job {
    const id = this.newJobId()
    const job = new Job(id, ctx.name ?? id, null, isSupervisor)
    const jobCtx = ctx.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: null, builder: 'scope', ctx: jobCtx.summary(),
      ...(varName === undefined ? {} : { varName }),
    })
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })
    const task: Task = {
      job, ctx: jobCtx, body: (function* (): VoidCoroutineBody { })(), resumeValue: undefined,
      resumeThrow: undefined, started: true, finished: true, unwinding: false, inlineStack: [],
      startLine: undefined, resumeLine: undefined,
      parentDispatcher: null,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    return job
  }

  /**
   * ENTER an inline scope: from here until `exitInline`, every event emitted
   * on behalf of "the current job" belongs to this scope, not to the
   * enclosing task.
   *
   * Kept separate from `spawnInline` and required to be called as the FIRST
   * statement inside the very same `try` that has `exitInline` in its
   * `finally`. Pushing anywhere else opens a window where the stack is dirty
   * but the `finally` isn't armed to fix it yet: `withContext` yields a
   * dispatcher-switch point RIGHT AFTER creating the job, and if the job is
   * cancelled at exactly that point, `unwindCancelled` throws into the
   * generator BEFORE `try` — the pop never runs, and every println after
   * that (including the user's own cleanup `finally`) gets tagged with the
   * id of a scope whose body never ran. This exact bug was measured before
   * splitting it out.
   */
  enterInline(job: Job): void {
    if (!this.currentTask) {
      throw new Error(
        `Scheduler: enterInline(${job.id}) outside of running a task. An inline scope only ` +
        'exists inside a coroutine body — no task means no stack to push onto.',
      )
    }
    this.currentTask.inlineStack.push(job)
  }

  /**
   * Leave an inline scope. The pop must match the job on top — if it
   * doesn't, throw instead of failing silently, since a mismatched stack
   * would misattribute EVERY println that follows.
   *
   * Called from the interpreter's `finally`, NOT from completeInline/failInline.
   * An inline scope has THREE exit paths, and the third — a child of the
   * scope fails, so the interpreter re-throws at `if (job.failure)` — goes
   * through neither of those two functions. Putting the pop there would leak
   * the stack on exactly that path.
   */
  exitInline(job: Job): void {
    const task = this.currentTask
    if (!task) {
      throw new Error(`Scheduler: exitInline(${job.id}) outside of running a task`)
    }
    const top = task.inlineStack.pop()
    if (top !== job) {
      throw new Error(
        `Scheduler: inline stack mismatch — popped ${job.id} but the top was ${top?.id ?? 'empty'}`,
      )
    }
  }

  /**
   * An inline scope's task has no real generator (its body runs inside the
   * enclosing task), so nothing else ever sets `finished` for it. Now that
   * waiters check `finished` and not just state, skipping this step would
   * leave a parent's joinChildren hanging forever on a scope that's already
   * Completed.
   */
  private settleInline(job: Job): void {
    const task = this.tasks.get(job.id)
    if (task) task.finished = true
  }

  completeInline(job: Job): void {
    this.settleInline(job)
    if (job.isCompleted) return
    job.transitionTo('Completing')
    this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Active', to: 'Completing' })
    job.transitionTo('Completed')
    this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Completing', to: 'Completed' })
  }

  /**
   * The counterpart to completeInline, for the FAILURE path of an inline
   * scope (coroutineScope/supervisorScope/runBlocking/withContext).
   *
   * Without this function, the interpreter would only have completeInline to
   * call in `finally`, meaning an exception escaping the scope's body would
   * still be recorded in the trace as a SUCCESSFUL COMPLETION: the scope's
   * children would never be cancelled (running on as orphans), no
   * FAILURE_PROPAGATED would be emitted, and EXCEPTION_THROWN would be
   * attributed to the enclosing job instead of to the scope itself.
   */
  failInline(job: Job, cause: FailureCause): void {
    this.settleInline(job)
    // If the job has already finished, this isn't a new failure — just the
    // same exception continuing to unwind back out through the scope's frame
    // (e.g. the scope was already killed earlier by one of its own children).
    // Recording it again would duplicate the event.
    if (job.isCompleted) return
    this.emitter.emit({
      k: 'EXCEPTION_THROWN', id: job.id, exType: cause.exType, message: cause.message,
    }, cause.line)
    reportFailure(job, cause, this.emitter)
  }

  cancelById(jobId: JobId, cause: FailureCause): void {
    const task = this.tasks.get(jobId)
    if (task) cancelJob(task.job, cause, this.emitter, 'user')
  }
}
