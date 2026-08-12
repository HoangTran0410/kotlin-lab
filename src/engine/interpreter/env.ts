import type { JobId } from '../trace/events'
import type { KValue } from './values'

export class Env {
  private readonly vars = new Map<string, KValue>()

  /**
   * `ownerJobId` is the LEXICALLY enclosing coroutine scope.
   * It must live in Env, not in the Scheduler's transient state:
   * `Scheduler.currentJob` gets reset on every step(), so after a single
   * suspend/resume a `launch` inside `coroutineScope { }` would attach to the
   * wrong parent. Env follows the closure, so it stays correct even with
   * several coroutines interleaving.
   */
  constructor(
    private readonly parent: Env | null = null,
    private readonly ownerJobId: JobId | null = null,
  ) {}

  /** Pass a jobId when opening a new coroutine scope; null means inherit the outer scope. */
  child(ownerJobId: JobId | null = null): Env { return new Env(this, ownerJobId) }

  get enclosingJobId(): JobId | null {
    return this.ownerJobId ?? this.parent?.enclosingJobId ?? null
  }

  declare(name: string, value: KValue): void { this.vars.set(name, value) }

  get(name: string): KValue | undefined {
    return this.vars.get(name) ?? this.parent?.get(name)
  }

  /** Whether `name` has been declared (in this scope or a parent scope). */
  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false)
  }

  set(name: string, value: KValue): boolean {
    if (this.vars.has(name)) { this.vars.set(name, value); return true }
    return this.parent?.set(name, value) ?? false
  }
}
