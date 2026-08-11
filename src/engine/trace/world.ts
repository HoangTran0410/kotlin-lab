import type { Event, JobId, JobState, ThreadId } from './events'

export interface JobView {
  id: JobId
  parentId: JobId | null
  builder: string
  state: JobState
  dispatcher: string
  name: string | null
  isSupervisor: boolean
  suspendReason: string | null
  threadId: ThreadId | null
  cause: string | null
}

export interface ThreadView { id: ThreadId; state: 'RUNNING' | 'FREE' }

export interface WorldState {
  t: number
  jobs: Map<JobId, JobView>
  threads: Map<ThreadId, ThreadView>
  output: string[]
  /** Edge failure/cancel đang hoạt động tại step này, để UI vẽ token. */
  lastEvent: Event | null
}

/** Dựng lại trạng thái bằng cách áp dụng event [0, upTo). Hàm thuần. */
export function foldTrace(events: readonly Event[], upTo: number): WorldState {
  const w: WorldState = { t: 0, jobs: new Map(), threads: new Map(), output: [], lastEvent: null }
  const n = Math.max(0, Math.min(upTo, events.length))

  for (let i = 0; i < n; i++) {
    const e = events[i]!
    w.t = e.t
    w.lastEvent = e

    switch (e.k) {
      case 'COROUTINE_CREATED':
        w.jobs.set(e.id, {
          id: e.id, parentId: e.parentId, builder: e.builder, state: 'New',
          dispatcher: e.ctx.dispatcher, name: e.ctx.name, isSupervisor: e.ctx.isSupervisor,
          suspendReason: null, threadId: null, cause: null,
        })
        break
      case 'JOB_STATE': {
        const j = w.jobs.get(e.id)
        if (j) { j.state = e.to; if (e.cause) j.cause = e.cause }
        break
      }
      case 'COROUTINE_STARTED':
      case 'COROUTINE_RESUMED': {
        const j = w.jobs.get(e.id)
        if (j) { j.threadId = e.threadId; j.suspendReason = null }
        break
      }
      case 'COROUTINE_SUSPENDED': {
        const j = w.jobs.get(e.id)
        if (j) { j.suspendReason = e.reason; j.threadId = null }
        break
      }
      case 'DISPATCH': {
        const j = w.jobs.get(e.id)
        if (j) j.threadId = e.threadId
        break
      }
      case 'THREAD_STATE':
        w.threads.set(e.threadId, { id: e.threadId, state: e.state })
        break
      case 'PRINTLN':
        w.output.push(e.text)
        break
      default:
        break
    }
  }
  return w
}
