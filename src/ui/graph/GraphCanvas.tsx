import { useMemo } from 'react'
import { MarkerType, ReactFlow, type Edge, type EdgeTypes, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FlowEdgeData, ReactFlowGraph } from './toReactFlow'
import { JobNode } from './nodes/JobNode'
import { ScopeNode } from './nodes/ScopeNode'
import { FailureEdge } from './edges/FailureEdge'
import { edgeStyle } from './edges/edgeStyle'
import './graph.css'

// HẰNG SỐ NGOÀI component (brief Task 13 bước 3): để nodeTypes/edgeTypes là
// literal khai trong JSX thì React Flow coi đó là một "loại" mới ở MỖI lần
// render (so sánh tham chiếu) và gắn lại (remount) toàn bộ node/cạnh — đúng
// kiểu rung mà toàn bộ Quyết định 2 (Task 11/12) tồn tại để chặn, chỉ là ở
// tầng React Flow's node-identity thay vì ở toạ độ.
const NODE_TYPES: NodeTypes = { job: JobNode, scope: ScopeNode }
const EDGE_TYPES: EdgeTypes = { failure: FailureEdge }

const FALLBACK_EDGE_DATA: FlowEdgeData = { kind: 'child', blocked: false, opacity: 1 }

/**
 * Mount `<ReactFlow>` thật. `nodes`/`edges` tới thẳng từ `toReactFlow` (Task
 * 12) — hàm THUẦN không phụ thuộc runtime @xyflow/react — nên component này
 * không được TÍNH LẠI `position` dưới bất kỳ hình thức nào; `nodes` chuyển
 * tiếp NGUYÊN XI.
 *
 * `edges` thì được gắn thêm hình dáng hiển thị (Task 14): `toReactFlow` trả
 * cạnh THUẦN (chỉ `data.kind`/`data.blocked`/`data.opacity`), không mang
 * style riêng của React Flow (markerEnd, stroke...) — việc đó là của TẦNG
 * HIỂN THỊ này, qua `edgeStyle()`, để `toReactFlow` giữ được là hàm thuần
 * không phụ thuộc runtime @xyflow/react. Chỉ cạnh 'failure' cần component
 * riêng (FailureEdge, để vẽ dấu chặn khi `blockedBySupervisor`); 'child' và
 * 'cancel' dùng edge mặc định của React Flow với style/markerEnd đặt thẳng
 * trên object Edge.
 */
export function GraphCanvas({ nodes, edges }: ReactFlowGraph) {
  const rfEdges = useMemo<Edge[]>(() => edges.map(e => {
    const d = e.data ?? FALLBACK_EDGE_DATA
    const visual = edgeStyle(d.kind, d.blocked)
    return {
      ...e,
      type: d.kind === 'failure' ? 'failure' : undefined,
      style: {
        stroke: visual.stroke,
        strokeWidth: visual.strokeWidth,
        strokeDasharray: visual.strokeDasharray,
        opacity: d.opacity,
      },
      markerEnd: visual.markerVariant === 'arrow' ? { type: MarkerType.ArrowClosed, color: visual.stroke } : undefined,
    }
  }), [edges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={false}
      fitView
    />
  )
}
