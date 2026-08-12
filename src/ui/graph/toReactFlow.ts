import type { Edge, Node } from '@xyflow/react'
import type { JobState } from '../../engine/trace/events'
import type { GraphEdgeSpec, GraphSpec } from '../../engine/trace/graph'
import type { WorldState } from '../../engine/trace/world'
import type { LayoutResult } from './elkLayout'
import { phase, type Phase } from './nodeStyle'

export interface FlowNodeData extends Record<string, unknown> {
  /** Tên người dùng đặt (`CoroutineName(...)`), hoặc null. Hiển thị là việc của Task 13. */
  name: string | null
  builder: string
  isSupervisor: boolean
  phase: Phase
  /** null ⟺ chưa sinh ra (world.jobs chưa có). */
  state: JobState | null
  /** Chỉ khác null khi state ∈ {Cancelling, Cancelled} — khoá tồn đọng B4, xem bên dưới. */
  cause: string | null
  suspendReason: string | null
}

export type FlowNodeType = 'scope' | 'job'
export type FlowNode = Node<FlowNodeData, FlowNodeType>

export interface FlowEdgeData extends Record<string, unknown> {
  kind: GraphEdgeSpec['kind']
  /** Chỉ có nghĩa với kind 'failure' — xem GraphEdgeSpec.blocked. */
  blocked: boolean
  /**
   * 0.18 khi cạnh 'child' trỏ tới một node CHƯA sinh ra (khớp opacity bóng mờ
   * của node unborn, Quyết định 2 lựa chọn b); 1 trong mọi trường hợp khác.
   * Cạnh failure/cancel chỉ có mặt trong mảng SAU KHI đã xảy ra (xem dưới),
   * nên luôn full opacity khi có mặt.
   */
  opacity: number
}
export type FlowEdge = Edge<FlowEdgeData>

export interface ReactFlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/**
 * Hàm THUẦN, trái tim của việc chống rung (Quyết định 2). Ba đối số vào, node/
 * edge của React Flow ra — không side effect, không async, không chạm DOM.
 *
 * `position` LẤY TỪ `layout`, KHÔNG BAO GIỜ từ `world`. Đây là bất biến trung
 * tâm của Quyết định 2: layout tính một lần cho mỗi lần compile, còn `world`
 * đổi ở mỗi step. Cho `world` chạm vào toạ độ là graph rung ngay — kéo qua N
 * step là N lần bố cục nhảy.
 *
 * Node chưa sinh ra (`world.jobs` chưa có) vẫn được PHÁT RA, dưới dạng bóng mờ
 * (`data.phase === 'unborn'`). Bỏ nó đi thì React Flow bỏ node khỏi cây, và
 * khi nó xuất hiện lại thì React Flow gắn lại node MỚI — mất hiệu ứng chuyển,
 * và với node compound thì con bị mồ côi một khung hình.
 *
 * State đọc theo TỪNG node từ `world.jobs`. KHÔNG suy state con từ state cha:
 * tồn đọng M1 (A1) cho phép cha phát `Completed` TRƯỚC KHI `finally` của con
 * chạy xong, nên "cha xong ⇒ con xong" là SAI trên trace này. Không thu gọn,
 * không làm mờ cả subtree khi cha Completed.
 *
 * Thứ tự mảng trả về giữ NGUYÊN `spec.nodes` (Task 4 đã khoá cha luôn đứng
 * trước con). Bắt buộc: React Flow đọc `parentId` và đặt toạ độ con TƯƠNG ĐỐI
 * với cha, nên nếu cha xuất hiện SAU con trong mảng thì mọi node lồng nhau
 * lệch vị trí — layoutGraph (Task 11) lại hoàn toàn không nhạy với thứ tự này
 * (nó dựng cây bằng tra `parentId`), nên đây là tầng DUY NHẤT còn canh được.
 */
export function toReactFlow(spec: GraphSpec, layout: LayoutResult, world: WorldState): ReactFlowGraph {
  const nodes: FlowNode[] = []
  const present = new Set<string>()

  for (const n of spec.nodes) {
    const box = layout.get(n.id)
    // Layout thiếu box cho node này (vd elkLayout lỗi/spec-layout lệch nhau) —
    // bỏ qua CHỨ KHÔNG NÉM. Một node không vẽ được vẫn hơn cả graph vỡ.
    if (!box) continue

    const job = world.jobs.get(n.id)
    const ph = phase(n, world)
    const state: JobState | null = job?.state ?? null
    // B4: cause tồn tại trên job xuyên qua các transition không mang cause
    // (foldTrace chỉ ghi đè khi e.cause truthy). Chỉ tin nó khi state đang
    // Cancelling/Cancelled; state khác thì coi cause là rác còn sót lại.
    const cause = job !== undefined && (job.state === 'Cancelling' || job.state === 'Cancelled')
      ? job.cause
      : null

    const node: FlowNode = {
      id: n.id,
      type: n.isContainer ? 'scope' : 'job',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: {
        name: n.name,
        builder: n.builder,
        isSupervisor: n.isSupervisor,
        phase: ph,
        state,
        cause,
        suspendReason: job?.suspendReason ?? null,
      },
    }
    if (n.parentId !== null) {
      node.parentId = n.parentId
      node.extent = 'parent'
    }
    nodes.push(node)
    present.add(n.id)
  }

  // Cạnh failure/cancel chỉ "đã xảy ra" (và do đó chỉ được vẽ) khi event sinh
  // ra nó không muộn hơn event cuối cùng đã áp dụng ở step đang xem.
  const lastSeq = world.lastEvent?.seq ?? -1

  const edges: FlowEdge[] = []
  for (const e of spec.edges) {
    // Node đầu/cuối bị bỏ qua ở trên (thiếu box) thì cạnh trỏ tới nó cũng bỏ
    // qua — React Flow không chấp nhận cạnh mồ côi.
    if (!present.has(e.source) || !present.has(e.target)) continue
    if (e.kind !== 'child' && e.firstSeq > lastSeq) continue

    const opacity = e.kind === 'child' && !world.jobs.has(e.target) ? 0.18 : 1
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      data: { kind: e.kind, blocked: e.blocked, opacity },
    })
  }

  return { nodes, edges }
}
