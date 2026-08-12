import type { Event } from '../trace/events'
import { applyEvent, emptyWorld } from '../trace/world'
import { narrate } from './narrate'

/** Tông màu của một dòng diễn giải. Tầng hiển thị dùng để tô, không mang ngữ nghĩa engine. */
export type NarrationTone = 'normal' | 'fail' | 'cancel' | 'output' | 'start'

export interface NarrationLine {
  /** Chỉ số trong mảng `events`. UI dùng để nhảy tới đúng step. */
  index: number
  seq: number
  /** Mili giây ảo. */
  t: number
  text: string
  tone: NarrationTone
}

function toneOf(e: Event): NarrationTone {
  switch (e.k) {
    case 'EXCEPTION_THROWN':
    case 'FAILURE_PROPAGATED':
      return 'fail'
    case 'CANCEL_REQUESTED':
      return 'cancel'
    case 'JOB_STATE':
      return e.to === 'Cancelled' || e.to === 'Cancelling' ? 'cancel' : 'normal'
    case 'PRINTLN':
      return 'output'
    case 'COROUTINE_CREATED':
    case 'COROUTINE_STARTED':
      return 'start'
    default:
      return 'normal'
  }
}

/**
 * Diễn giải cả trace trong MỘT lượt duyệt.
 *
 * Không gọi `foldTrace` cho từng event: fold dựng lại từ đầu mỗi lần, nên làm
 * vậy là O(N²) — ở M2 đã đo được 3,9 giây trên trace 16 nghìn event. Ở đây thế
 * giới được cuộn dần bằng `applyEvent`, đúng cái hàm mà `foldTrace` dùng, nên
 * không có bản fold thứ hai để trôi lệch.
 *
 * `narrate` được gọi TRƯỚC `applyEvent` — câu nói về thế giới ngay trước event.
 */
export function narrateTrace(events: readonly Event[]): NarrationLine[] {
  const out: NarrationLine[] = []
  const w = emptyWorld()
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const text = narrate(e, w)
    if (text !== null) out.push({ index: i, seq: e.seq, t: e.t, text, tone: toneOf(e) })
    applyEvent(w, e)
  }
  return out
}
