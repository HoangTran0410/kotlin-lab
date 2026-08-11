import type { Event, JobId } from './events'

export interface GraphNodeSpec {
  id: JobId
  parentId: JobId | null
  builder: string
  /** Container ⟺ có ≥1 con. KHÔNG suy theo builder: launch/async cũng có con. */
  isContainer: boolean
  isSupervisor: boolean
  name: string | null
  dispatcher: string
  /** seq của COROUTINE_CREATED. UI dùng để biết node đã "sinh ra" ở step nào. */
  bornAt: number
}

export interface GraphEdgeSpec {
  id: string
  source: JobId
  target: JobId
  kind: 'child' | 'failure' | 'cancel'
  /** Chỉ có nghĩa với kind 'failure'. */
  blocked: boolean
  /** seq của event đầu tiên tạo ra cạnh này. */
  firstSeq: number
}

export interface GraphSpec {
  nodes: GraphNodeSpec[]
  edges: GraphEdgeSpec[]
}

/**
 * Bộ xương graph, suy từ TOÀN BỘ trace — cố ý không nhận `upTo`.
 *
 * Vì sao không dựng graph từ `foldTrace(events, n)`: tập job lớn dần theo step,
 * nên ELK sẽ nhận đồ thị khác nhau ở mỗi step và trả toạ độ khác nhau. Mọi node
 * đã có sẽ nhảy chỗ mỗi khi một node mới sinh ra — không tua được.
 *
 * Tách hình dạng (hàm này, bất biến) khỏi trạng thái (`foldTrace`, theo step).
 * ELK chạy một lần cho mỗi lần compile; tua chỉ đổi diện mạo, không đổi vị trí.
 *
 * An toàn vì `foldTrace` chỉ THÊM job, không bao giờ xoá — tập node đơn điệu
 * tăng, nên tập đầy đủ là hợp của mọi tập trung gian.
 */
export function buildGraphSpec(events: readonly Event[]): GraphSpec {
  const nodes: GraphNodeSpec[] = []
  const byId = new Map<JobId, GraphNodeSpec>()
  const edges: GraphEdgeSpec[] = []
  const edgeSeen = new Set<string>()

  const addEdge = (
    source: JobId, target: JobId, kind: GraphEdgeSpec['kind'], blocked: boolean, firstSeq: number,
  ): void => {
    const id = `${kind}:${source}->${target}`
    // Gộp lần lặp lại: cùng một cặp có thể phát nhiều lần trong trace (vd
    // cancel lan xuống rồi lan lại). Cạnh là quan hệ, không phải lần xuất hiện.
    if (edgeSeen.has(id)) return
    edgeSeen.add(id)
    edges.push({ id, source, target, kind, blocked, firstSeq })
  }

  for (const e of events) {
    switch (e.k) {
      case 'COROUTINE_CREATED': {
        const n: GraphNodeSpec = {
          id: e.id, parentId: e.parentId, builder: e.builder, isContainer: false,
          isSupervisor: e.ctx.isSupervisor, name: e.ctx.name,
          dispatcher: e.ctx.dispatcher, bornAt: e.seq,
        }
        // Thứ tự chèn = thứ tự COROUTINE_CREATED = cha luôn trước con, vì con
        // không thể được tạo trước khi cha tồn tại. React Flow đòi đúng thế.
        nodes.push(n)
        byId.set(e.id, n)
        const parent = e.parentId === null ? undefined : byId.get(e.parentId)
        if (parent) {
          parent.isContainer = true
          addEdge(parent.id, e.id, 'child', false, e.seq)
        }
        break
      }
      case 'FAILURE_PROPAGATED':
        // Có thể trỏ vào node ĐÃ Cancelled (tồn đọng M1). Vẫn vẽ: nó mô tả
        // quan hệ với-tới-được theo cấu trúc, không phải trạng thái sống.
        addEdge(e.from, e.to, 'failure', e.blockedBySupervisor, e.seq)
        break
      case 'CANCEL_REQUESTED':
        if (e.from !== 'user') addEdge(e.from, e.to, 'cancel', false, e.seq)
        break
      default:
        break
    }
  }

  return { nodes, edges }
}
