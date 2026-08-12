import { type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../toReactFlow'
import { stateBorder } from '../nodeStyle'
import { NodePorts } from './NodePorts'
import '../graph.css'

/**
 * Node compound (có con) — hộp trong suốt bao lấy các node con, chỉ có tiêu
 * đề, không nền. Viền màu THEO STATE giống JobNode (cùng nguồn `stateBorder`,
 * để "đang chạy/đã xong/đã huỷ" đọc nhất quán ở cả hai loại node).
 *
 * `isSupervisor` đổi NÉT viền (đôi thay vì đơn) chứ không chỉ đổi màu — brief
 * Task 13 bước 2 yêu cầu tường minh: phân biệt supervisor bằng HÌNH DẠNG, vì
 * ranh giới supervisor là bài học quan trọng nhất của công cụ (xem
 * FailureEdge.tsx) và không được phép mất đi trên ảnh chụp đen trắng hay với
 * người học mù màu.
 */
export function ScopeNode({ id, data }: NodeProps<FlowNode>) {
  const unborn = data.phase === 'unborn'
  const classes = ['k-scope-node']
  if (data.isSupervisor) classes.push('k-scope-node--supervisor')
  if (unborn) classes.push('k-scope-node--unborn')
  if (data.isCurrent && !unborn) classes.push('k-scope-node--current')

  return (
    <div
      className={classes.join(' ')}
      style={{ borderColor: data.state ? stateBorder(data.state) : 'var(--fg-dim)' }}
      data-testid="scope-node"
      data-phase={data.phase}
    >
      <NodePorts />
      {!unborn && (
        <div className="k-scope-node__title">
          {data.name ?? data.builder}
          <span className="k-scope-node__id">{id}</span>
          {data.isSupervisor && <span className="k-scope-node__tag">supervisor</span>}
          {data.lastPrint !== null && (
            <span className="k-scope-node__print" title={data.lastPrint}>» {data.lastPrint}</span>
          )}
        </div>
      )}
    </div>
  )
}
