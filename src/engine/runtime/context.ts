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
  ) {}

  static empty(): CoroutineContext {
    return new CoroutineContext(null, null, null, null)
  }

  /** Giá trị dùng thật khi chạy; chưa đặt thì là Default, giống Kotlin. */
  get dispatcher(): string { return this.dispatcherOrNull ?? 'Default' }

  withJob(job: Job): CoroutineContext {
    return new CoroutineContext(job, this.dispatcherOrNull, this.name, this.handler)
  }
  withDispatcher(d: string): CoroutineContext {
    return new CoroutineContext(this.job, d, this.name, this.handler)
  }
  withName(n: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, n, this.handler)
  }
  withHandler(h: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, this.name, h)
  }

  /** Toán tử + của Kotlin: element bên phải ghi đè element cùng loại bên trái. */
  plus(other: CoroutineContext): CoroutineContext {
    return new CoroutineContext(
      other.job ?? this.job,
      other.dispatcherOrNull ?? this.dispatcherOrNull,
      other.name ?? this.name,
      other.handler ?? this.handler,
    )
  }

  summary(): CtxSummary {
    return {
      dispatcher: this.dispatcher,
      name: this.name,
      isSupervisor: this.job?.isSupervisor ?? false,
      hasHandler: this.handler !== null,
    }
  }
}
