import type { JobId } from '../trace/events'
import type { KValue } from './values'

export class Env {
  private readonly vars = new Map<string, KValue>()

  /**
   * `ownerJobId` là coroutine scope bao quanh về mặt LEXICAL.
   * Nó phải sống trong Env chứ không phải trong state tạm của Scheduler:
   * `Scheduler.currentJob` bị đặt lại mỗi step(), nên sau một lần suspend/resume
   * thì `launch` bên trong `coroutineScope { }` sẽ gắn nhầm parent.
   * Env đi theo closure nên đúng cả khi nhiều coroutine xen kẽ nhau.
   */
  constructor(
    private readonly parent: Env | null = null,
    private readonly ownerJobId: JobId | null = null,
  ) {}

  /** Truyền jobId khi mở một coroutine scope mới; null nghĩa là kế thừa scope ngoài. */
  child(ownerJobId: JobId | null = null): Env { return new Env(this, ownerJobId) }

  get enclosingJobId(): JobId | null {
    return this.ownerJobId ?? this.parent?.enclosingJobId ?? null
  }

  declare(name: string, value: KValue): void { this.vars.set(name, value) }

  get(name: string): KValue | undefined {
    return this.vars.get(name) ?? this.parent?.get(name)
  }

  set(name: string, value: KValue): boolean {
    if (this.vars.has(name)) { this.vars.set(name, value); return true }
    return this.parent?.set(name, value) ?? false
  }
}
