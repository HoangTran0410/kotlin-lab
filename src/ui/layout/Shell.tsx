import type { ReactNode } from 'react'
import { SimulationNotice } from '../common/SimulationNotice'
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
  return (
    <div className="shell">
      <header className="shell__head">
        <h1>Kotlin Coroutines Lab</h1>
        {nav}
      </header>
      <SimulationNotice />
      <div className={debugOpen ? 'shell__main' : 'shell__main shell__main--focus'}>
        <div className="shell__left">{editor}</div>
        <div className="shell__center">{graph}</div>
        {debugOpen && <div className="shell__right">{side}</div>}
      </div>
      {debugOpen && <footer className="shell__foot">{timeline}</footer>}
    </div>
  )
}
