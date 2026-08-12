import type { CtxSummary } from '../trace/events'
import type { Job } from './job'

export class CoroutineContext {
  /**
   * Mọi element lưu dạng `T | null`, trong đó null nghĩa là "chưa đặt".
   * Phân biệt này là bắt buộc: plus() phải biết bên phải có thực sự đặt
   * dispatcher hay không, chứ không thể đoán từ giá trị mặc định.
   */
  private constructor(
    readonly job: Job | null,
    private readonly dispatcherOrNull: string | null,
    readonly name: string | null,
    readonly handler: string | null,
    private readonly supervisorOrNull: boolean | null,
  ) {}

  static empty(): CoroutineContext {
    return new CoroutineContext(null, null, null, null, null)
  }

  /** Giá trị dùng thật khi chạy; chưa đặt thì là Default, giống Kotlin. */
  get dispatcher(): string { return this.dispatcherOrNull ?? 'Default' }

  /**
   * Element Job của context có phải SupervisorJob không. `null` bên trong nghĩa
   * là "chưa đặt Job nào" — cùng quy ước với dispatcher, và cần đúng vì
   * `CoroutineScope(SupervisorJob() + Dispatchers.IO)` phải phân biệt được với
   * `CoroutineScope(Job() + Dispatchers.IO)`: nếu chỉ có `false` mặc định thì
   * `plus()` không biết bên phải có thật sự đặt Job hay không.
   *
   * CHÚ Ý: đây là cờ của CONTEXT (thứ mà `applyCtxValue` đọc ra từ code Kotlin),
   * KHÁC với `Job.isSupervisor` (cờ của một Job đã tồn tại trong cây). `summary()`
   * cố ý đọc cờ của Job chứ không đọc cờ này — xem ghi chú ở đó.
   */
  get isSupervisor(): boolean { return this.supervisorOrNull ?? false }

  withJob(job: Job): CoroutineContext {
    return new CoroutineContext(job, this.dispatcherOrNull, this.name, this.handler, this.supervisorOrNull)
  }
  withDispatcher(d: string): CoroutineContext {
    return new CoroutineContext(this.job, d, this.name, this.handler, this.supervisorOrNull)
  }
  withName(n: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, n, this.handler, this.supervisorOrNull)
  }
  withHandler(h: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, this.name, h, this.supervisorOrNull)
  }
  withSupervisor(v: boolean): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, this.name, this.handler, v)
  }

  /** Toán tử + của Kotlin: element bên phải ghi đè element cùng loại bên trái. */
  plus(other: CoroutineContext): CoroutineContext {
    return new CoroutineContext(
      other.job ?? this.job,
      other.dispatcherOrNull ?? this.dispatcherOrNull,
      other.name ?? this.name,
      other.handler ?? this.handler,
      other.supervisorOrNull ?? this.supervisorOrNull,
    )
  }

  /**
   * `isSupervisor` đọc từ JOB, không đọc `supervisorOrNull`. Con của một scope
   * supervisor kế thừa context của scope (nên `supervisorOrNull` là true trên
   * đường truyền xuống), nhưng BẢN THÂN nó không phải supervisor — chỉ ranh giới
   * cha mới chặn được failure. Đọc nhầm cờ ở đây thì mọi con của
   * `CoroutineScope(SupervisorJob())` đều hiện ra trên trace như một supervisor,
   * và bài học "supervisor chặn TẠI RANH GIỚI" bị bôi ra cả cây.
   */
  summary(): CtxSummary {
    return {
      dispatcher: this.dispatcher,
      name: this.name,
      isSupervisor: this.job?.isSupervisor ?? false,
      hasHandler: this.handler !== null,
    }
  }
}
