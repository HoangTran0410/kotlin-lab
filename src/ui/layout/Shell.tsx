import type { ReactNode } from 'react'
import { SimulationNotice } from '../common/SimulationNotice'
import { Splitter } from './Splitter'
import { MAX_LEFT, MAX_RIGHT, MIN_LEFT, MIN_RIGHT, usePanelWidths } from './usePanelWidths'
import './shell.css'

/**
 * `debugOpen` quyết định có hiện cột phải (console + chẩn đoán + diễn giải đầy
 * đủ) và thanh timeline từng-event ở đáy hay không.
 *
 * Mặc định TẮT. Đồ thị đã mang sẵn câu giải thích của bước đang xem, nút tua,
 * và `println` ngay trên node — đủ để theo dõi mà không phải nhìn đi bốn góc.
 * Bảng gỡ lỗi là chỗ đào sâu (từng event một, console đầy đủ, lịch sử diễn
 * giải), không phải chỗ bắt buộc phải liếc để hiểu chuyện gì đang xảy ra.
 */
export function Shell({ nav, editor, graph, timeline, side, debugOpen }: {
  nav: ReactNode; editor: ReactNode; graph: ReactNode
  timeline: ReactNode; side: ReactNode; debugOpen: boolean
}) {
  const { left, right, setLeft, setRight, reset } = usePanelWidths()

  return (
    <div className="shell">
      <header className="shell__head">
        <h1>Kotlin Coroutines Lab</h1>
        {nav}
        <button type="button" className="shell__reset" onClick={reset} title="Đưa bề rộng các cột về mặc định">
          Bố cục mặc định
        </button>
      </header>
      <SimulationNotice />
      <div
        className="shell__main"
        // Bề rộng đi qua biến CSS chứ không viết thẳng grid-template vào style:
        // cách này giữ định nghĩa lưới ở một chỗ duy nhất trong CSS, và biểu
        // thức `1fr` cho cột giữa không phải dựng lại bằng chuỗi trong TSX.
        style={{
          '--w-left': `${left}px`,
          '--w-right': `${right}px`,
        } as React.CSSProperties}
        data-debug={debugOpen ? 'open' : 'closed'}
      >
        <div className="shell__left">{editor}</div>
        <Splitter label="Bề rộng cột mã" width={left} setWidth={setLeft} min={MIN_LEFT} max={MAX_LEFT} />
        <div className="shell__center">{graph}</div>
        {debugOpen && (
          <>
            <Splitter
              label="Bề rộng cột gỡ lỗi" width={right} setWidth={setRight}
              min={MIN_RIGHT} max={MAX_RIGHT} invert
            />
            <div className="shell__right">{side}</div>
          </>
        )}
      </div>
      {debugOpen && <footer className="shell__foot">{timeline}</footer>}
    </div>
  )
}
