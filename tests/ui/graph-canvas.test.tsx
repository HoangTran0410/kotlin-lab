import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { GraphCanvas } from '../../src/ui/graph/GraphCanvas'
import type { FlowNode } from '../../src/ui/graph/toReactFlow'

/**
 * GraphCanvas KHÔNG có test riêng nào trong brief Task 13 (brief chỉ đòi 6
 * test render node lẻ, "không mount cả React Flow") — nhưng đây chính là
 * tầng DUY NHẤT thật sự mount `<ReactFlow>`, và là chỗ một lỗi "tính lại vị
 * trí theo step" (điều Quyết định 2, Task 11/12 cấm) có thể lọt vào mà không
 * ai bắt được, vì `toReactFlow` (Task 12) chỉ khoá bất biến ở ĐẦU RA của
 * chính nó — không khoá được việc tầng SAU (đây) có tôn trọng đầu ra đó hay
 * không. Test dưới đây mount GraphCanvas THẬT để khoá đúng chỗ đó.
 *
 * Không kiểm màu/nét của cạnh ở đây: @xyflow/react đo vị trí handle bằng
 * getBoundingClientRect thật, jsdom không layout nên handle bounds không bao
 * giờ khởi tạo và cạnh không render — đúng ranh giới mà tests/ui/setup.ts đã
 * ghi chú (layout thật kiểm ở Task 20, Playwright). `edgeStyle()` bản thân nó
 * đã được khoá đầy đủ, thuần, ở tests/ui/edge-style.test.ts.
 */
function job(id: string, x: number, y: number): FlowNode {
  return {
    id, type: 'job', position: { x, y }, width: 200, height: 68,
    data: {
      name: id, builder: 'launch', isSupervisor: false, phase: 'live',
      state: 'Active', cause: null, suspendReason: null, lastPrint: null, printCount: 0, isCurrent: false,
    },
  }
}

describe('GraphCanvas (Task 13) — nơi React Flow thật được mount', () => {
  it('vị trí render RA ĐÚNG position được truyền vào — không tính lại (khoá Quyết định 2 ở tầng mount)', () => {
    const nodes = [job('a', 10, 20), job('b', 240, 88)]
    // Cạnh KHÔNG rỗng — nếu để rỗng, một phép biến đổi position ẩn phụ thuộc
    // edges.length (như sabotage đã đo ở trên) sẽ vô tình ra 0 và test này
    // xanh giả, không thật sự canh được điều nó tuyên bố canh.
    const edges = [
      { id: 'e1', source: 'a', target: 'b', data: { kind: 'child' as const, blocked: false, opacity: 1 } },
    ]
    const { container } = render(<GraphCanvas nodes={nodes} edges={edges} />)

    const a = container.querySelector<HTMLElement>('[data-id="a"]')
    const b = container.querySelector<HTMLElement>('[data-id="b"]')
    expect(a?.style.transform).toBe('translate(10px,20px)')
    expect(b?.style.transform).toBe('translate(240px,88px)')
  })

  it('vị trí không đổi giữa hai lần render với cùng input — không có phép biến đổi ẩn theo edges', () => {
    const nodes = [job('a', 5, 5)]
    const { container: c1 } = render(<GraphCanvas nodes={nodes} edges={[]} />)
    const { container: c2 } = render(
      <GraphCanvas
        nodes={nodes}
        edges={[
          { id: 'e1', source: 'a', target: 'a', data: { kind: 'child', blocked: false, opacity: 1 } },
          { id: 'e2', source: 'a', target: 'a', data: { kind: 'cancel', blocked: false, opacity: 1 } },
        ]}
      />,
    )
    const t1 = c1.querySelector<HTMLElement>('[data-id="a"]')?.style.transform
    const t2 = c2.querySelector<HTMLElement>('[data-id="a"]')?.style.transform
    expect(t1).toBe('translate(5px,5px)')
    expect(t2).toBe(t1)
  })

  it('node type "job" render bằng JobNode, "scope" render bằng ScopeNode — đúng nodeTypes', () => {
    const scope: FlowNode = { ...job('s', 0, 0), type: 'scope' }
    const { container } = render(<GraphCanvas nodes={[job('a', 0, 0), scope]} edges={[]} />)

    expect(container.querySelector('[data-id="a"] .k-job-node')).not.toBeNull()
    expect(container.querySelector('[data-id="a"] .k-scope-node')).toBeNull()
    expect(container.querySelector('[data-id="s"] .k-scope-node')).not.toBeNull()
    expect(container.querySelector('[data-id="s"] .k-job-node')).toBeNull()
  })
})
