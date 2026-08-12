import { useEffect, useRef } from 'react'
import type { NarrationLine } from '../../engine/narrate/narrateTrace'
import './narration.css'

/**
 * Tách chuỗi theo backtick: phần trong backtick in bằng font mã.
 *
 * `narrate` bọc mọi định danh (tên job, thread, kiểu exception) trong backtick
 * — quy ước duy nhất giữa engine và tầng hiển thị, xem narrate.ts. Không dùng
 * dangerouslySetInnerHTML: dựng thẳng phần tử React.
 */
function renderText(text: string): React.ReactNode[] {
  return text.split('`').map((phần, i) =>
    i % 2 === 1
      ? <code key={i} className="k-narration__code">{phần}</code>
      : <span key={i}>{phần}</span>,
  )
}

/**
 * Diễn giải theo từng bước: câu của bước đang xem, và toàn bộ câu trước đó.
 *
 * Chỉ hiện những câu ĐÃ TỚI (`index < stepIndex`). Hiện trước cả những câu
 * chưa tới sẽ tiết lộ kết cục — người học tua tới đâu mới nên biết tới đó.
 *
 * Component thuần, không tự đọc store: `lines`/`stepIndex`/`onJump` đều là
 * props, theo đúng khuôn của LessonNav và các panel khác.
 */
export function NarrationPanel({ lines, stepIndex, onJump }: {
  lines: readonly NarrationLine[]
  stepIndex: number
  onJump: (step: number) => void
}) {
  const đãTới = lines.filter(l => l.index < stepIndex)
  const cuối = useRef<HTMLLIElement>(null)

  // Tự cuộn tới câu mới nhất khi tua. `block: 'nearest'` để không kéo cả trang.
  // Gọi optional: jsdom (môi trường test) KHÔNG cài scrollIntoView, và một
  // panel phụ làm đổ cả App trong test là cái giá quá đắt cho một hiệu ứng cuộn.
  useEffect(() => {
    cuối.current?.scrollIntoView?.({ block: 'nearest' })
  }, [stepIndex])

  if (đãTới.length === 0) {
    return (
      <p className="k-narration__empty" data-testid="narration-empty">
        Kéo thanh dòng thời gian bên dưới (hoặc bấm ▶) để chạy từng bước. Mỗi bước sẽ được
        giải thích ở đây.
      </p>
    )
  }

  return (
    <ol className="k-narration">
      {đãTới.map((l, i) => {
        const hiệnTại = i === đãTới.length - 1
        return (
          <li
            key={l.index}
            ref={hiệnTại ? cuối : undefined}
            className={`k-narration__line k-narration__line--${l.tone}${hiệnTại ? ' k-narration__line--current' : ''}`}
            data-testid={hiệnTại ? 'narration-current' : 'narration-line'}
          >
            <button
              type="button"
              className="k-narration__jump"
              // +1 vì stepIndex đếm "đã áp dụng bao nhiêu event", còn index là
              // vị trí của event trong mảng.
              onClick={() => onJump(l.index + 1)}
              title="Nhảy tới bước này"
            >
              <span className="k-narration__t">{l.t}ms</span>
              <span className="k-narration__text">{renderText(l.text)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
