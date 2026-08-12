import type { Event, JobId, JobState, ThreadId } from './events'

export interface JobView {
  id: JobId
  parentId: JobId | null
  builder: string
  state: JobState
  dispatcher: string
  name: string | null
  /** Tên biến người học gán coroutine này vào. */
  varName: string | null
  isSupervisor: boolean
  suspendReason: string | null
  threadId: ThreadId | null
  cause: string | null
  /**
   * Dòng `println` gần nhất do CHÍNH job này in ra, và tổng số dòng nó đã in.
   *
   * `output` ở cấp WorldState là một mảng phẳng không mang id, nên console
   * hiện được nhưng đồ thị thì không: người học thấy chữ chạy ra ở panel bên
   * cạnh mà không biết node nào in. Giữ thêm ở đây để node tự hiện được câu
   * mình vừa in — `PRINTLN` vốn đã mang `id` chính xác từ khi attribution của
   * scope inline được sửa.
   */
  lastPrint: string | null
  printCount: number
  /**
   * Exception đã LÀM JOB NÀY HỎNG, kèm message.
   *
   * `cause` chỉ mang KIỂU (`"RuntimeException"`) vì nó đọc từ `JOB_STATE.cause`,
   * và nó có mặt trên cả những job bị huỷ lây — chúng không có message nào của
   * riêng mình. Message thật chỉ nằm trong `EXCEPTION_THROWN`, và trước đây nó
   * chết ở đó: đồ thị hiện đúng chữ "RuntimeException" và người học phải tua
   * trúng một event duy nhất mới đọc được "Child 1 failed".
   */
  loi: { exType: string; message: string } | null
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
   * Job mà event cuối cùng NÓI VỀ — dùng để làm nổi node đang diễn ra trên đồ
   * thị. Khác `lastEvent`: event hạ tầng (`THREAD_STATE`) không mang job nào
   * nên KHÔNG được xoá giá trị cũ, nếu không vòng nhấn mạnh sẽ nhấp nháy tắt
   * bật suốt trace — cùng lý do `srcLine` phải dính.
   */
  activeJobId: JobId | null
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
  return {
    t: 0, jobs: new Map(), threads: new Map(), output: [],
    lastEvent: null, activeJobId: null, srcLine: null,
  }
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
  // DÍNH như srcLine: event hạ tầng không mang job thì giữ nguyên job cũ.
  if ('id' in e && typeof e.id === 'string') w.activeJobId = e.id
  else if (e.k === 'FAILURE_PROPAGATED' || e.k === 'CANCEL_REQUESTED') w.activeJobId = e.to

  switch (e.k) {
    case 'COROUTINE_CREATED':
      w.jobs.set(e.id, {
        id: e.id, parentId: e.parentId, builder: e.builder, state: 'New',
        dispatcher: e.ctx.dispatcher, name: e.ctx.name, varName: e.varName ?? null,
        isSupervisor: e.ctx.isSupervisor,
        suspendReason: null, threadId: null, cause: null,
        lastPrint: null, printCount: 0, loi: null,
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
    case 'EXCEPTION_THROWN': {
      const j = w.jobs.get(e.id)
      if (j) j.loi = { exType: e.exType, message: e.message }
      break
    }
    case 'PRINTLN': {
      w.output.push(e.text)
      const j = w.jobs.get(e.id)
      if (j) { j.lastPrint = e.text; j.printCount++ }
      break
    }
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
