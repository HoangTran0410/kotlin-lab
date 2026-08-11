import type { JobId, ThreadId } from '../trace/events'

/** Số thread ảo mỗi dispatcher. Nhỏ hơn thực tế để hình vẽ đọc được. */
export const DISPATCHER_POOL_SIZE: Record<string, number> = {
  Main: 1,
  Default: 4,
  IO: 8,
  Unconfined: 1,
}

export interface VirtualThread {
  id: ThreadId
  dispatcher: string
  jobId: JobId | null
}

export class DispatcherPool {
  private readonly threads = new Map<ThreadId, VirtualThread>()
  /** Thứ tự dispatcher được tạo, để allThreads ổn định. */
  private readonly order: string[] = []

  private ensure(dispatcher: string): VirtualThread[] {
    if (!this.order.includes(dispatcher)) {
      this.order.push(dispatcher)
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

  /** Trả thread rảnh đầu tiên, hoặc null nếu pool đã đầy. */
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
