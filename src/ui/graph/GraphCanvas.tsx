import { ReactFlow, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ReactFlowGraph } from './toReactFlow'
import { JobNode } from './nodes/JobNode'
import { ScopeNode } from './nodes/ScopeNode'
import './graph.css'

// HẰNG SỐ NGOÀI component (brief Task 13 bước 3): để nodeTypes là literal
// khai trong JSX thì React Flow coi đó là một "loại" mới ở MỖI lần render (so
// sánh tham chiếu) và gắn lại (remount) toàn bộ node — đúng kiểu rung mà
// Quyết định 2 (Task 11/12) tồn tại để chặn, chỉ là ở tầng React Flow's
// node-identity thay vì ở toạ độ.
const NODE_TYPES: NodeTypes = { job: JobNode, scope: ScopeNode }

/**
 * Mount `<ReactFlow>` thật. `nodes`/`edges` tới thẳng từ `toReactFlow` (Task
 * 12) — hàm THUẦN không phụ thuộc runtime @xyflow/react — nên component này
 * không được TÍNH LẠI `position` dưới bất kỳ hình thức nào; nó chỉ chuyển
 * tiếp nguyên xi. Việc gắn hình dáng riêng cho từng loại cạnh (Task 14) sửa
 * trong chính file này, không đụng tới nhánh `nodes`.
 */
export function GraphCanvas({ nodes, edges }: ReactFlowGraph) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      fitView
    />
  )
}
