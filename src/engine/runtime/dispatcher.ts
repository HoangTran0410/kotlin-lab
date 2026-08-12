import type { JobId, ThreadId } from '../trace/events'

/** Number of virtual threads per dispatcher. Smaller than real life so the diagram stays readable. */
export const DISPATCHER_POOL_SIZE: Record<string, number> = {
  Main: 1,
  Default: 4,
  IO: 8,
  // Unconfined has no pool of its own. The scheduler uses one deterministic
  // carrier marker because this simulator intentionally runs one continuation at a time.
  Unconfined: 0,
}

export interface VirtualThread {
  id: ThreadId
  dispatcher: string
  jobId: JobId | null
}

export class DispatcherPool {
  private readonly threads = new Map<ThreadId, VirtualThread>()
  /** Order in which dispatchers were created, so allThreads stays stable. */
  private readonly order: string[] = []

  private ensure(dispatcher: string): VirtualThread[] {
    if (!this.order.includes(dispatcher)) {
      this.order.push(dispatcher)
      if (dispatcher === 'Unconfined') {
        const id = 'Unconfined-carrier'
        this.threads.set(id, { id, dispatcher, jobId: null })
        return this.threadsOf(dispatcher)
      }
      const n = DISPATCHER_POOL_SIZE[dispatcher] ?? 1
      for (let i = 1; i <= n; i++) {
        const id = `${dispatcher}-${i}`
        this.threads.set(id, { id, dispatcher, jobId: null })
      }
    }
    return this.threadsOf(dispatcher)
  }

  threadsOf(dispatcher: string): VirtualThread[] {
    return [...this.threads.values()].filter(t => t.dispatcher === dispatcher)
  }

  allThreads(): VirtualThread[] {
    return this.order.flatMap(d => this.threadsOf(d))
  }

  /** Returns the first free thread, or null if the pool is full. */
  acquire(dispatcher: string, jobId: JobId): ThreadId | null {
    const free = this.ensure(dispatcher).find(t => t.jobId === null)
    if (!free) return null
    free.jobId = jobId
    return free.id
  }

  release(threadId: ThreadId): void {
    const t = this.threads.get(threadId)
    if (t) t.jobId = null
  }
}
