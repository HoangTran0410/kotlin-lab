import type { Event } from '../../engine/trace/events'

/** Các loại event đủ "đáng chú ý" để vẽ vạch trên timeline. */
export type NotableKind =
  | 'COROUTINE_CREATED'
  | 'EXCEPTION_THROWN'
  | 'FAILURE_PROPAGATED'
  | 'CANCEL_REQUESTED'
  | 'PRINTLN'

export interface Marker {
  kind: NotableKind
  /**
   * "Diễn viên" của event, dùng làm một phần khoá gộp trùng (k, id, t).
   * Event mang `id` (COROUTINE_CREATED/EXCEPTION_THROWN/PRINTLN) dùng thẳng
   * id đó; event chỉ mang `from`/`to` (FAILURE_PROPAGATED/CANCEL_REQUESTED)
   * dùng cặp `"from->to"` làm định danh — không có trường `id` đơn lẻ nào để
   * dùng cho hai loại này.
   */
  actorId: string
  /** Thời gian ảo (world.t) tại lần xuất hiện ĐẦU TIÊN bị gộp vào marker này. */
  t: number
  /**
   * Vị trí 0-100 dọc theo timeline. Timeline chạy [0, events.length] (Task
   * 16 bước 2: điểm cuối là events.length, KHÔNG phải lúc root Completed) —
   * event ở chỉ số mảng 0-based `i` chỉ THẬT SỰ xuất hiện trong world khi
   * stepIndex >= i+1 (foldTrace áp event [0, upTo)), nên vị trí tự nhiên của
   * nó trên thanh là (i+1)/events.length*100: kéo đúng tới đó là vạch "sáng".
   */
  pct: number
}

interface NotableInfo {
  kind: NotableKind
  actorId: string
}

/**
 * event không đáng chú ý (bao gồm THREAD_STATE/JOB_STATE — 91/159 event
 * trong ba lesson, sẽ làm thanh đặc kín vạch) trả null. Switch trên `e.k`
 * để TypeScript tự thu hẹp `e` theo từng nhánh — không cần ép kiểu.
 */
function notableInfo(e: Event): NotableInfo | null {
  switch (e.k) {
    case 'COROUTINE_CREATED':
    case 'EXCEPTION_THROWN':
    case 'PRINTLN':
      return { kind: e.k, actorId: e.id }
    case 'FAILURE_PROPAGATED':
    case 'CANCEL_REQUESTED':
      return { kind: e.k, actorId: `${e.from}->${e.to}` }
    default:
      return null
  }
}

/**
 * Gộp trùng theo (k, id, t). Tồn đọng M1: EXCEPTION_THROWN phát HAI LẦN khi
 * throw xuyên qua root đã unwrap. Vẽ hai vạch chồng nhau trông như lỗi render.
 *
 * Gộp chỉ ảnh hưởng phần VẼ. `stepIndex` vẫn đếm theo từng event, nên kéo qua
 * vẫn dừng ở cả hai — trace là nguồn sự thật, marker chỉ là chỉ dẫn nhìn.
 */
export function buildMarkers(events: readonly Event[]): Marker[] {
  const seen = new Set<string>()
  const markers: Marker[] = []
  const total = events.length

  events.forEach((e, i) => {
    const info = notableInfo(e)
    if (info === null) return
    const key = `${info.kind}:${info.actorId}:${e.t}`
    if (seen.has(key)) return
    seen.add(key)
    markers.push({ ...info, t: e.t, pct: ((i + 1) / total) * 100 })
  })

  return markers
}
