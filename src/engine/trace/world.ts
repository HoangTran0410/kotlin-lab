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
  /**
   * Dòng 1-based đang chạy, hoặc null nếu chưa event nào mang dòng.
   * DÍNH: event không mang `srcLine` KHÔNG xoá giá trị cũ. Nếu xoá, dòng
   * highlight sẽ nhấp nháy tắt/bật suốt trace, vì các event hạ tầng
   * (THREAD_STATE, JOB_STATE) xen giữa mọi bước và chúng không thuộc dòng nào.
   */
  srcLine: number | null
}

/** Thế giới lúc chưa có event nào. */
export function emptyWorld(): WorldState {
  return { t: 0, jobs: new Map(), threads: new Map(), output: [], lastEvent: null, srcLine: null }
}

/**
 * Áp MỘT event lên `w`, tại chỗ.
 *
 * Tách ra khỏi `foldTrace` để `narrateTrace` (engine/narrate) cuộn thế giới
 * bằng đúng logic này thay vì chép lại. Hai bản fold lệch nhau là loại lỗi
 * không ai phát hiện được cho tới khi câu diễn giải nói một đằng còn đồ thị
 * vẽ một nẻo — và lúc đó không có test nào chỉ ra bên nào sai.
 *
 * Cố tình mutate: đây là vòng trong của cả `foldTrace` lẫn `narrateTrace`,
 * cấp phát một WorldState mới cho mỗi event là O(N) lần sao chép cả Map.
 * Tính thuần được giữ ở tầng ngoài — `foldTrace` luôn bắt đầu từ `emptyWorld`.
 */
export function applyEvent(w: WorldState, e: Event): void {
  w.t = e.t
  w.lastEvent = e
  if (e.srcLine !== undefined) w.srcLine = e.srcLine

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

/** Dựng lại trạng thái bằng cách áp dụng event [0, upTo). Hàm thuần. */
export function foldTrace(events: readonly Event[], upTo: number): WorldState {
  const w = emptyWorld()
  const n = Math.max(0, Math.min(upTo, events.length))
  for (let i = 0; i < n; i++) applyEvent(w, events[i]!)
  return w
}
