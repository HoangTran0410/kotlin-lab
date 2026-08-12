import { type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../toReactFlow'
import { builderAccent, stateBorder } from '../nodeStyle'
import { NodePorts } from './NodePorts'
import '../graph.css'

/**
 * Node lá (`launch`/`async`/... không có con). Accent TRÁI theo builder (màu
 * "đây là launch/async/..."), viền THEO STATE (màu "đang ở đâu trong vòng đời
 * job"), huy hiệu suspend khi job đang treo, tên job.
 *
 * `unborn` (COROUTINE_CREATED của nó chưa xảy ra ở step đang xem — xem
 * nodeStyle.ts `phase()`): viền đứt + mờ hẳn (graph.css `--unborn`), và ẨN
 * TOÀN BỘ nội dung — kể cả tên, dù `data.name` đã có sẵn từ lúc compile (tên
 * là thuộc tính TĨNH của spec, không phụ thuộc step). Lộ tên sớm sẽ "tiết lộ
 * trước" nội dung của một bước tua chưa tới, đi ngược mục đích của bóng mờ.
 */
export function JobNode({ id, data }: NodeProps<FlowNode>) {
  const unborn = data.phase === 'unborn'
  // Khoá tồn đọng B4 (xem toReactFlow.ts): data.cause đã được gác cổng ở tầng
  // dữ liệu (null trừ khi state ∈ {Cancelling, Cancelled}), nhưng JobNode tự
  // kiểm lại state ở ĐÂY — phòng thủ theo chiều sâu, không dựa hẳn vào upstream.
  const showCause = data.cause !== null && (data.state === 'Cancelling' || data.state === 'Cancelled')
  const border = data.state ? stateBorder(data.state) : 'var(--fg-dim)'

  return (
    <div
      className={[
        'k-job-node',
        unborn ? 'k-job-node--unborn' : '',
        data.isCurrent && !unborn ? 'k-job-node--current' : '',
      ].filter(Boolean).join(' ')}
      // Bốn longhand tường minh, KHÔNG dùng shorthand `borderColor` cùng lúc với
      // `borderLeftColor`: khi trộn chung trong MỘT style object, một số engine
      // CSSOM (đo được ở jsdom, dùng cho test) coi bốn cạnh "không đồng nhất"
      // và bỏ hẳn phần còn lại thay vì tách thành bốn longhand — viền theo
      // state biến mất khỏi `style` attribute. Viết tường minh tránh phụ thuộc
      // hành vi ngầm đó.
      style={{
        borderTopColor: border, borderRightColor: border, borderBottomColor: border,
        borderLeftColor: builderAccent(data.builder),
      }}
      data-testid="job-node"
      data-phase={data.phase}
    >
      <NodePorts />
      {!unborn && (
        <>
          <span className="k-job-node__head">
            <span className="k-job-node__name">{data.name ?? data.builder}</span>
            {/* Id luôn hiện, kể cả khi đã có CoroutineName. Ba `launch` anh em
                mà cùng hiện đúng chữ "launch" thì không chỉ được vào cái nào —
                và phần diễn giải bên dưới đồ thị gọi tên job theo đúng id này,
                nên bỏ nó đi là cắt đứt cầu nối giữa câu chữ và hình vẽ. */}
            <span className="k-job-node__id">{id}</span>
          </span>
          {data.suspendReason !== null && <span className="k-job-node__badge">{data.suspendReason}</span>}
          {showCause && <span className="k-job-node__cause">{data.cause}</span>}
          {/* println hiện NGAY TRÊN node đã in nó. Trước đây chữ chỉ chạy ra
              panel console bên cạnh, nên nhìn đồ thị không biết node nào in —
              phải liếc sang chỗ khác rồi tự ghép lại. */}
          {data.lastPrint !== null && (
            <span className="k-job-node__print" title={data.lastPrint}>
              <span className="k-job-node__print-mark">»</span>
              {data.lastPrint}
              {data.printCount > 1 && <span className="k-job-node__print-n">+{data.printCount - 1}</span>}
            </span>
          )}
        </>
      )}
    </div>
  )
}
