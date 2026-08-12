import type { KeyboardEvent } from 'react'
import type { Event } from '../../engine/trace/events'
import { buildMarkers, type NotableKind } from './markers'
import './timeline.css'

/** Shift + mũi tên nhảy 10 bước (Task 16 bước 2). */
const BIG_STEP = 10

const MARKER_LABEL: Readonly<Record<NotableKind, string>> = {
  COROUTINE_CREATED: 'Coroutine được tạo',
  EXCEPTION_THROWN: 'Exception bị ném',
  FAILURE_PROPAGATED: 'Lỗi lan lên cha',
  CANCEL_REQUESTED: 'Yêu cầu huỷ',
  PRINTLN: 'In ra console',
}

/**
 * `<input type="range">` gốc: kéo hai chiều bằng con trỏ, phím mũi tên,
 * Home/End và hỗ trợ screen reader đều có sẵn — KHÔNG tự cài kéo bằng pointer
 * event, tự viết là mua lại toàn bộ đống đó kèm lỗi.
 *
 * Duy nhất phải tự cài: Shift+mũi tên (nhảy 10 bước) và chính ←/→/Home/End,
 * vì hành vi bàn phím mặc định của range input KHÔNG được test ở đây (jsdom
 * không mô phỏng — đã đo bằng test thăm dò trước khi viết file này) và không
 * đồng nhất giữa các trình duyệt. `preventDefault()` trên các phím tự xử lý
 * để không double-step khi trình duyệt thật cũng có hành vi mặc định riêng.
 *
 * `max` là `events.length`, KHÔNG phải chỉ số lúc root `Completed` — tồn đọng
 * B3: `GlobalScope.launch` còn in sau khi `runBlocking` xong, cắt ở đó sẽ
 * giấu mất phần trace còn lại.
 *
 * `t` (thời gian ảo hiện tại) đọc THẲNG từ `events[stepIndex - 1].t`, không
 * gọi `foldTrace` — event cuối cùng đã áp dụng ở step `stepIndex` chính là
 * `events[stepIndex - 1]` (foldTrace áp [0, upTo) và luôn set `w.t = e.t` ở
 * mỗi vòng lặp), nên tra thẳng mảng là đủ, rẻ hơn gập lại cả world.
 */
export function Timeline({ events, stepIndex, setStep }: {
  events: readonly Event[]
  stepIndex: number
  setStep: (n: number) => void
}) {
  const max = events.length
  const disabled = max === 0
  const t = stepIndex > 0 ? (events[stepIndex - 1]?.t ?? 0) : 0
  const markers = buildMarkers(events)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const jump = e.shiftKey ? BIG_STEP : 1
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        setStep(Math.min(max, stepIndex + jump))
        break
      case 'ArrowLeft':
        e.preventDefault()
        setStep(Math.max(0, stepIndex - jump))
        break
      case 'Home':
        e.preventDefault()
        setStep(0)
        break
      case 'End':
        e.preventDefault()
        setStep(max)
        break
      default:
        break
    }
  }

  return (
    <div className="timeline">
      <div className="timeline__track">
        <input
          type="range"
          className="timeline__range"
          aria-label="Thanh kéo dòng thời gian"
          min={0}
          max={max}
          value={disabled ? 0 : stepIndex}
          disabled={disabled}
          onChange={e => setStep(Number(e.target.value))}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="timeline__markers" aria-hidden="true">
        {markers.map(m => (
          <span
            key={`${m.kind}:${m.actorId}:${m.t}`}
            className={`timeline-marker timeline-marker--${m.kind.toLowerCase()}`}
            style={{ left: `${m.pct}%` }}
            title={MARKER_LABEL[m.kind]}
          />
        ))}
      </div>
      <div className="timeline__status">
        <span>bước {stepIndex} / {max}</span>
        <span>t = {t}ms</span>
      </div>
    </div>
  )
}
