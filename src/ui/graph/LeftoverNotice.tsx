import { useMemo } from 'react'
import type { Event } from '../../engine/trace/events'
import { coroutineDangDo, thieuRunBlocking } from '../../engine/trace/leftover'

/**
 * "Chương trình kết thúc khi còn N coroutine đang dừng giữa chừng."
 *
 * Ca đã gặp thật: `fun main() { CoroutineScope(...).launch { delay(500); ... } }`
 * — không `runBlocking` nào. Chương trình chạy xong trong 0ms, output rỗng,
 * đồ thị đầy node đứng im, và KHÔNG có một chữ nào nói vì sao. Kotlin thật cũng
 * cho ra output rỗng, nên đây không phải lỗi của engine — nhưng im lặng thì vẫn
 * là câu trả lời tệ nhất có thể cho câu hỏi "sao nó không chạy?".
 *
 * Hiện ở đầu sân khấu đồ thị, chỗ mắt đang nhìn khi thấy không có gì xảy ra —
 * không giấu sau nút gỡ lỗi.
 */
export function LeftoverNotice({ events, source }: { events: readonly Event[]; source: string }) {
  const { nhan } = useMemo(() => coroutineDangDo(events), [events])
  if (events.length === 0 || nhan.length === 0) return null

  const thieu = thieuRunBlocking(source)
  return (
    <div className="k-stage__leftover" role="note" data-testid="leftover-notice">
      <strong>{nhan.length} coroutine bị bỏ lại giữa chừng.</strong>{' '}
      Chương trình kết thúc khi coroutine GỐC kết thúc — y như JVM thoát ngay sau khi{' '}
      <code>main</code> trả về và giết mọi thread daemon. Những cái này chưa chạy xong:{' '}
      {nhan.map((n, i) => (
        <span key={`${n}-${i}`}>{i > 0 ? ', ' : ''}<code>{n}</code></span>
      ))}.
      {thieu && (
        <>
          {' '}
          <strong>Không có <code>runBlocking</code> nào trong file.</strong>{' '}
          <code>fun main() {'{ ... }'}</code> trả về ngay lập tức, nên không ai chờ chúng cả. Đổi
          thành <code>fun main() = runBlocking {'{ ... }'}</code> rồi <code>join()</code> (hoặc{' '}
          <code>delay</code>) đủ lâu để thấy chúng chạy.
        </>
      )}
    </div>
  )
}
