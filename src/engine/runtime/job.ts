import type { JobId, JobState } from '../trace/events'

export interface FailureCause {
  exType: string
  message: string
  isCancellation: boolean
  /** Dòng 1-based của câu `throw` gây ra, nếu KotlinThrow gốc mang theo. */
  line?: number
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
  /**
   * Riêng tư, chỉ đổi được qua transitionTo. Nếu để public thì mọi module
   * hạ nguồn đều có thể gán thẳng `job.state = 'Cancelled'`, bỏ qua đúng
   * bảng ALLOWED mà class này sinh ra để canh.
   */
  private _state: JobState = 'New'

  /** Vì-sao job kết thúc bất thường, cho trace. Đặt ở CẢ hai đường: bị cancel và fail. */
  cause: FailureCause | null = null

  /**
   * Chỉ đặt khi job THẬT SỰ FAIL — chính nó ném, hoặc failure của con leo lên
   * qua nó. KHÔNG đặt khi job bị cancel từ ngoài (user gọi cancel(), hay bị kéo
   * theo vì anh em fail).
   *
   * Đây là thứ phân biệt hai exception mà thân coroutine nhận được khi unwind,
   * và nó chính là bài học của milestone này:
   *   - job FAIL   -> thân nhận lại ĐÚNG exception gốc, nên
   *                   `coroutineScope { launch { throw RuntimeException } }`
   *                   ném RuntimeException ra ngoài như Kotlin thật.
   *   - job bị CANCEL -> thân nhận CancellationException, nên một coroutine vô
   *                   can bị kéo theo KHÔNG bắt nhầm exception của thằng khác.
   * Gộp chung vào `cause` thì hai ca này không thể phân biệt: `cause` của anh em
   * bị kéo theo cũng là RuntimeException("boom") của kẻ gây ra.
   */
  failure: FailureCause | null = null

  /** Mảng, không phải Set — thứ tự phải ổn định để trace deterministic. */
  private readonly _children: Job[] = []

  /**
   * Job của một scope builder chạy TẠI CHỖ: coroutineScope / supervisorScope /
   * withContext. Đối ứng của `isScopedCoroutine` trong kotlinx.
   *
   * Ý nghĩa DUY NHẤT của cờ này: khi job kết thúc bất thường, exception được
   * TRẢ VỀ continuation của người gọi (tức ném ra ngay tại chỗ gọi, bắt được
   * bằng try/catch của Kotlin) chứ KHÔNG huỷ job cha. kotlinx làm đúng thế
   * trong JobSupport.cancelParent: `if (isScopedCoroutine) return true`.
   *
   * Thiếu cờ này thì failure của con leo thẳng qua scope lên tới runBlocking:
   * trace ghi coroutine gốc là Cancelled trong khi chương trình vẫn chạy tiếp
   * và in ra, còn thứ tự unwind thì đảo — catch của tổ tiên chạy TRƯỚC finally
   * của con cháu, ngược hẳn Kotlin.
   *
   * KHÔNG bật cho runBlocking: BlockingCoroutine của kotlinx không phải
   * ScopeCoroutine, nó chặn luồng gọi chứ không trả exception vào continuation.
   */
  readonly isScopeCoroutine: boolean

  constructor(
    readonly id: JobId,
    readonly name: string,
    readonly parent: Job | null,
    readonly isSupervisor: boolean,
    isScopeCoroutine = false,
  ) {
    this.isScopeCoroutine = isScopeCoroutine
  }

  get state(): JobState { return this._state }

  /** readonly: thêm con bắt buộc qua addChild để liên kết luôn khớp hai chiều. */
  get children(): readonly Job[] { return this._children }

  get isActive(): boolean { return this._state === 'Active' }
  get isCompleted(): boolean { return this._state === 'Completed' || this._state === 'Cancelled' }
  get isCancelled(): boolean { return this._state === 'Cancelled' }

  /**
   * Liên kết cha-con phải khớp hai chiều. Nếu lệch, job con sẽ nằm ngoài
   * `children` của cha và bị BỎ SÓT khi lan cancel — sai lặng lẽ, không có
   * tín hiệu lỗi nào. Thà chết sớm ở đây còn hơn sai âm thầm ở Task 13.
   */
  addChild(child: Job): void {
    if (child.parent !== this) {
      throw new Error(
        `Job ${this.id}: addChild(${child.id}) nhưng child.parent không trỏ về job này. ` +
        'Liên kết cha-con phải khớp hai chiều.',
      )
    }
    this._children.push(child)
  }

  transitionTo(next: JobState): void {
    if (!ALLOWED[this._state].includes(next)) {
      throw new Error(`Job ${this.id}: chuyển trạng thái không hợp lệ ${this._state} -> ${next}`)
    }
    this._state = next
  }

  /** Duyệt sâu, thứ tự ổn định. */
  descendants(): Job[] {
    const out: Job[] = []
    const walk = (j: Job) => { for (const c of j.children) { out.push(c); walk(c) } }
    walk(this)
    return out
  }
}
