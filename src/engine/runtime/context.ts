import type { CtxSummary } from '../trace/events'
import type { Job } from './job'

export class CoroutineContext {
  /**
   * Every element is stored as `T | null`, where null means "not set". This
   * distinction is mandatory: plus() must know whether the right-hand side
   * actually set a dispatcher, rather than guessing from a default value.
   */
  private constructor(
    readonly job: Job | null,
    private readonly dispatcherOrNull: string | null,
    readonly name: string | null,
    readonly handler: string | null,
    private readonly supervisorOrNull: boolean | null,
  ) {}

  static empty(): CoroutineContext {
    return new CoroutineContext(null, null, null, null, null)
  }

  /** The value actually used at runtime; if not set, it's Default, like Kotlin. */
  get dispatcher(): string { return this.dispatcherOrNull ?? 'Default' }

  /**
   * Whether the context's Job element is a SupervisorJob. An internal `null`
   * means "no Job set yet" — same convention as dispatcher, and it needs to
   * be exact because `CoroutineScope(SupervisorJob() + Dispatchers.IO)` must
   * be distinguishable from `CoroutineScope(Job() + Dispatchers.IO)`: if
   * there were only a default `false`, `plus()` wouldn't know whether the
   * right-hand side actually set a Job.
   *
   * NOTE: this is the CONTEXT's flag (what `applyCtxValue` reads out of the
   * Kotlin code), DIFFERENT from `Job.isSupervisor` (the flag of a Job that
   * already exists in the tree). `summary()` deliberately reads the Job's
   * flag, not this one — see the note there.
   */
  get isSupervisor(): boolean { return this.supervisorOrNull ?? false }

  withJob(job: Job): CoroutineContext {
    return new CoroutineContext(job, this.dispatcherOrNull, this.name, this.handler, this.supervisorOrNull)
  }
  withDispatcher(d: string): CoroutineContext {
    return new CoroutineContext(this.job, d, this.name, this.handler, this.supervisorOrNull)
  }
  withName(n: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, n, this.handler, this.supervisorOrNull)
  }
  withHandler(h: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, this.name, h, this.supervisorOrNull)
  }
  withSupervisor(v: boolean): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, this.name, this.handler, v)
  }

  /** Kotlin's + operator: the right-hand element overrides the left-hand element of the same kind. */
  plus(other: CoroutineContext): CoroutineContext {
    return new CoroutineContext(
      other.job ?? this.job,
      other.dispatcherOrNull ?? this.dispatcherOrNull,
      other.name ?? this.name,
      other.handler ?? this.handler,
      other.supervisorOrNull ?? this.supervisorOrNull,
    )
  }

  /**
   * `isSupervisor` reads from the JOB, not from `supervisorOrNull`. A child
   * of a supervisor scope inherits the scope's context (so `supervisorOrNull`
   * is true as it propagates down), but the child ITSELF is not a
   * supervisor — only the parent boundary blocks failure. Reading the wrong
   * flag here would make every child of `CoroutineScope(SupervisorJob())`
   * show up in the trace as a supervisor, and the lesson "supervisor blocks
   * AT THE BOUNDARY" would smear across the whole tree.
   */
  summary(): CtxSummary {
    return {
      dispatcher: this.dispatcher,
      name: this.name,
      isSupervisor: this.job?.isSupervisor ?? false,
      hasHandler: this.handler !== null,
    }
  }
}
