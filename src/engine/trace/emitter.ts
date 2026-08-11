import type { Event, EventBody } from './events'

export class TraceEmitter {
  private seq = 0
  private t = 0
  readonly events: Event[] = []

  setClock(t: number): void { this.t = t }
  get clock(): number { return this.t }

  /**
   * Lưu ý cho bên GỌI: body được spread NÔNG, nên object lồng bên trong
   * (vd ctx của COROUTINE_CREATED) được giữ theo THAM CHIẾU. Luôn dựng
   * object mới cho mỗi lần emit; dùng lại rồi sửa sẽ làm event lịch sử
   * đổi theo, phá vỡ tính 'trace là nguồn sự thật duy nhất'.
   */
  emit(body: EventBody, srcLine?: number): void {
    const e = { ...body, seq: this.seq++, t: this.t } as Event
    if (srcLine !== undefined) e.srcLine = srcLine
    this.events.push(e)
  }
}
