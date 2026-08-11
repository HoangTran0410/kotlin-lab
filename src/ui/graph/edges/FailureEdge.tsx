import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { FlowEdge } from '../toReactFlow'
import { edgeStyle } from './edgeStyle'
import '../graph.css'

/**
 * Renderer RIÊNG cho cạnh 'failure'. Lý do cần một component thay vì chỉ style
 * trên object Edge (đủ cho 'child'/'cancel'): trường hợp `blockedBySupervisor`
 * cần vẽ DẤU CHẶN — một đoạn ngang đặc tại đầu mũi tên, thay cho mũi tên — thứ
 * marker SVG chuẩn của React Flow không biểu đạt được, và cần một nhãn tiếng
 * Việt đặt cạnh nó. Đây chính là bài học mà progress.md Task 13 nói tới:
 * không có `FAILURE_PROPAGATED.blockedBySupervisor` thì không có gì để vẽ ranh
 * giới supervisor — ở đây nó là DỮ LIỆU (`data.blocked`), không phải một op
 * `block` hard-code như bản HTML cũ.
 *
 * 'child' và 'cancel' KHÔNG cần component riêng: `edgeStyle()` cho đủ
 * stroke/dash/marker để đặt thẳng lên object Edge (xem GraphCanvas.tsx), và
 * edge mặc định của React Flow vẽ chúng đúng.
 */
export function FailureEdge({
  sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, markerEnd, style,
}: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const blocked = data?.blocked ?? false
  const opacity = data?.opacity ?? 1
  const visual = edgeStyle('failure', blocked)

  return (
    <>
      <BaseEdge
        path={path}
        // Bị chặn -> không mũi tên lọt qua được nữa (xem edgeStyle.ts markerVariant).
        markerEnd={visual.markerVariant === 'arrow' ? markerEnd : undefined}
        style={{ ...style, stroke: visual.stroke, strokeWidth: visual.strokeWidth, opacity }}
      />
      {visual.markerVariant === 'block' && (
        <EdgeLabelRenderer>
          <div
            className="k-edge-block-mark"
            style={{ transform: `translate(-50%, -50%) translate(${targetX}px, ${targetY}px)`, opacity }}
          />
          <div
            className="k-edge-block-label"
            style={{ transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY}px)`, opacity }}
          >
            {visual.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
