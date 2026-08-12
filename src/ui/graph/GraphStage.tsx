import { useCallback, useMemo } from 'react'
import type { NarrationLine } from '../../engine/narrate/narrateTrace'
import { usePlayback } from '../timeline/usePlayback'
import { GraphCanvas } from './GraphCanvas'
import type { ReactFlowGraph } from './toReactFlow'
import './graph-stage.css'

/** Chữ trong backtick in bằng font mã — cùng quy ước với NarrationPanel. */
function renderText(text: string): React.ReactNode[] {
  return text.split('`').map((phần, i) =>
    i % 2 === 1
      ? <code key={i} className="k-stage__code">{phần}</code>
      : <span key={i}>{phần}</span>,
  )
}

/**
 * Đồ thị + mọi thứ cần để THEO DÕI nó, gom vào một chỗ.
 *
 * Bố cục cũ bắt mắt chạy bốn góc: code bên trái, đồ thị ở giữa, giải thích và
 * console bên phải, thanh kéo dưới đáy. Muốn biết "đang xảy ra gì" phải liếc
 * sang phải; muốn tua phải rê xuống đáy; `println` chỉ hiện ở panel bên cạnh
 * nên nhìn đồ thị không biết node nào in. Bốn vùng cho một mạch suy nghĩ.
 *
 * Ở đây: câu diễn giải của bước đang xem nằm NGAY DƯỚI đồ thị, nút tua nằm
 * cạnh nó, `println` hiện trên chính node đã in (xem JobNode). Bảng console và
 * thanh timeline đầy đủ trở thành thứ mở ra khi cần đào sâu, không phải thứ
 * phải nhìn để hiểu chuyện gì đang xảy ra.
 *
 * Tua bằng nút ở đây nhảy theo MỐC CÓ DIỄN GIẢI, không phải từng event: hơn
 * nửa số event là hạ tầng (`THREAD_STATE`, `JOB_STATE`) và dừng ở đó thì màn
 * hình không đổi gì. Thanh kéo trong bảng gỡ lỗi vẫn đi từng event một.
 */
export function GraphStage({ graph, narration, stepIndex, setStep, total, debugOpen, toggleDebug }: {
  graph: ReactFlowGraph
  narration: readonly NarrationLine[]
  stepIndex: number
  setStep: (n: number) => void
  total: number
  debugOpen: boolean
  toggleDebug: () => void
}) {
  const đãTới = useMemo(
    () => narration.filter(l => l.index < stepIndex),
    [narration, stepIndex],
  )
  const hiệnTại = đãTới.length > 0 ? đãTới[đãTới.length - 1]! : null
  const sốMốc = narration.length
  const mốcHiệnTại = đãTới.length

  const mốcKế = useCallback(
    (cur: number) => {
      const kế = narration.find(l => l.index >= cur)
      return kế ? kế.index + 1 : total
    },
    [narration, total],
  )

  const { playing, play, pause } = usePlayback(stepIndex, setStep, total, mốcKế)

  const lùi = useCallback(() => {
    const trước = narration.filter(l => l.index < stepIndex - 1)
    setStep(trước.length > 0 ? trước[trước.length - 1]!.index + 1 : 0)
  }, [narration, stepIndex, setStep])

  const tiến = useCallback(() => setStep(mốcKế(stepIndex)), [mốcKế, setStep, stepIndex])

  const trống = total === 0

  return (
    <div className="k-stage">
      <div className="k-stage__canvas">
        <GraphCanvas nodes={graph.nodes} edges={graph.edges} />
      </div>

      <div className="k-stage__bar">
        <div className="k-stage__controls">
          <button
            type="button" onClick={() => setStep(0)}
            disabled={trống || stepIndex === 0} aria-label="Về đầu"
          >⏮</button>
          <button
            type="button" onClick={lùi}
            disabled={trống || stepIndex === 0} aria-label="Mốc trước"
          >◀</button>
          <button
            type="button" className="k-stage__play"
            onClick={playing ? pause : play} disabled={trống}
            // Tên KHÁC nút phát trong bảng gỡ lỗi, vì hai nút bước theo hai
            // đơn vị khác nhau: ở đây là mốc có diễn giải, ở kia là từng event.
            // Trùng tên thì cả trình đọc màn hình lẫn test đều không phân biệt được.
            aria-pressed={playing}
            aria-label={playing ? 'Tạm dừng phát theo mốc' : 'Phát theo mốc'}
          >{playing ? '⏸' : '▶'}</button>
          <button
            type="button" onClick={tiến}
            disabled={trống || stepIndex >= total} aria-label="Mốc sau"
          >▶|</button>
          <span className="k-stage__count" data-testid="stage-count">
            {mốcHiệnTại}/{sốMốc}
          </span>
          <span className="k-stage__clock">{hiệnTại ? `${hiệnTại.t}ms` : '0ms'}</span>
        </div>

        <p
          className={`k-stage__caption k-stage__caption--${hiệnTại?.tone ?? 'normal'}`}
          data-testid="stage-caption"
        >
          {hiệnTại
            ? renderText(hiệnTại.text)
            : <span className="k-stage__hint">Bấm ▶ hoặc ▶| để chạy từng bước. Mỗi bước được giải thích ngay tại đây.</span>}
        </p>

        <button
          type="button"
          className="k-stage__debug"
          onClick={toggleDebug}
          aria-pressed={debugOpen}
        >
          {debugOpen ? 'Đóng bảng gỡ lỗi' : 'Gỡ lỗi sâu'}
        </button>
      </div>
    </div>
  )
}
