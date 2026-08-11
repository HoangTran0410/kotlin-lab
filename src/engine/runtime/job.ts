import type { JobId, JobState } from '../trace/events'

export interface FailureCause {
  exType: string
  message: string
  isCancellation: boolean
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
  state: JobState = 'New'
  cause: FailureCause | null = null
  /** Mảng, không phải Set — thứ tự phải ổn định để trace deterministic. */
  readonly children: Job[] = []

  constructor(
    readonly id: JobId,
    readonly name: string,
    readonly parent: Job | null,
    readonly isSupervisor: boolean,
  ) {}

  get isActive(): boolean { return this.state === 'Active' }
  get isCompleted(): boolean { return this.state === 'Completed' || this.state === 'Cancelled' }
  get isCancelled(): boolean { return this.state === 'Cancelled' }

  addChild(child: Job): void { this.children.push(child) }

  transitionTo(next: JobState): void {
    if (!ALLOWED[this.state].includes(next)) {
      throw new Error(`Job ${this.id}: chuyển trạng thái không hợp lệ ${this.state} -> ${next}`)
    }
    this.state = next
  }

  /** Duyệt sâu, thứ tự ổn định. */
  descendants(): Job[] {
    const out: Job[] = []
    const walk = (j: Job) => { for (const c of j.children) { out.push(c); walk(c) } }
    walk(this)
    return out
  }
}
