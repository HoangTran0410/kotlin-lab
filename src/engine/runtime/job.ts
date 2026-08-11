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
  /**
   * Riêng tư, chỉ đổi được qua transitionTo. Nếu để public thì mọi module
   * hạ nguồn đều có thể gán thẳng `job.state = 'Cancelled'`, bỏ qua đúng
   * bảng ALLOWED mà class này sinh ra để canh.
   */
  private _state: JobState = 'New'
  cause: FailureCause | null = null

  /** Mảng, không phải Set — thứ tự phải ổn định để trace deterministic. */
  private readonly _children: Job[] = []

  constructor(
    readonly id: JobId,
    readonly name: string,
    readonly parent: Job | null,
    readonly isSupervisor: boolean,
  ) {}

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
