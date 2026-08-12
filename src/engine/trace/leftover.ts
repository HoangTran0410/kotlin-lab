import type { Event } from './events'
import { jobLabel } from './label'
import { foldTrace, type JobView } from './world'

/**
 * Coroutine còn dang dở lúc chương trình kết thúc.
 *
 * Vì sao cần: chương trình dừng khi coroutine GỐC dừng, y như JVM thoát ngay
 * sau khi `main` trả về và giết mọi thread daemon. Nên `fun main() { ... }`
 * (dạng block, không `runBlocking`) chạy xong trong 0ms và bỏ lại mọi thứ nó
 * vừa phóng ra — không in gì, không ném gì, không lỗi gì.
 *
 * Kotlin thật cũng hành xử đúng như thế (đã đối chiếu: chương trình dạng đó
 * cho ra output RỖNG trên playground). Nhưng "đúng và im lặng" ở đây là hỏng:
 * người học thấy một màn hình trắng và không có gì nói cho họ biết vì sao. Đây
 * chính là chỗ một công cụ dạy học phải nói nhiều hơn trình biên dịch.
 *
 * CỐ Ý không phải một Diagnostic: code không sai cú pháp, và trên Kotlin thật
 * nó biên dịch sạch. Đây là một SỰ KIỆN của lần chạy, nên nó thuộc về trace.
 */
export interface ConDangDo {
  /** Job chưa đạt trạng thái kết thúc lúc trace hết. */
  jobs: JobView[]
  /** Nhãn để hiện, theo đúng thứ tự của `jobs`. */
  nhan: string[]
}

const CHUA_XONG = new Set(['New', 'Active', 'Completing', 'Cancelling'])

export function coroutineDangDo(events: readonly Event[]): ConDangDo {
  const w = foldTrace(events, events.length)
  const jobs = [...w.jobs.values()].filter(j => CHUA_XONG.has(j.state))
  return { jobs, nhan: jobs.map(jobLabel) }
}

/**
 * Chương trình có phải dạng `fun main() { ... }` KHÔNG có runBlocking không —
 * nguyên nhân số một của "chạy xong mà chẳng có gì xảy ra".
 *
 * Đọc trên NGUỒN chứ không trên AST: hàm này được gọi từ UI với chuỗi source
 * đang có sẵn, và nó chỉ dùng để chọn câu gợi ý, không để quyết định hành vi
 * nào của engine. Nhận nhầm thì cùng lắm là gợi ý không đúng chỗ.
 */
export function thieuRunBlocking(src: string): boolean {
  return !/\brunBlocking\b/.test(src)
}
