import { useMemo } from 'react'
import {
  Background, Controls, MarkerType, ReactFlow,
  type Edge, type EdgeTypes, type NodeTypes,
} from '@xyflow/react'
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
const FIT_VIEW = { padding: 0.18, maxZoom: 1 }

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
    // Hai làn tách hẳn nhau (xem NodePorts.tsx): failure leo mép PHẢI, cancel
    // đổ mép TRÁI. Nhờ vậy hai hướng lan truyền không bao giờ chạy chồng lên
    // nhau, và không cắt qua cột node ở giữa.
    const right = d.kind === 'failure'
    return {
      ...e,
      type: d.kind === 'failure' ? 'failure' : 'smoothstep',
      sourceHandle: right ? 'fail-out' : 'cancel-out',
      targetHandle: right ? 'fail-in' : 'cancel-in',
      // Khuỷu đẩy ra xa hộp: đường đi vòng hẳn ra ngoài mép thay vì bám sát
      // viền rồi cắt vào node kế bên.
      pathOptions: { offset: 28, borderRadius: 10 },
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
      // Chừa lề quanh đồ thị khi tự căn khung: fitView sát mép làm nhãn và
      // đường vòng hai bên bị cắt cụt ở rìa canvas.
      fitView
      fitViewOptions={FIT_VIEW}
      minZoom={0.2}
    >
      <Background gap={24} size={1} color="var(--border)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
