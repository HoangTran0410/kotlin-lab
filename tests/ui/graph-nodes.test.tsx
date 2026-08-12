import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { JobNode } from '../../src/ui/graph/nodes/JobNode'
import { ScopeNode } from '../../src/ui/graph/nodes/ScopeNode'
import { builderAccent, stateBorder } from '../../src/ui/graph/nodeStyle'
import type { FlowNode, FlowNodeData } from '../../src/ui/graph/toReactFlow'

/**
 * Render "node lẻ, không mount cả React Flow" (brief Task 13 bước 4): KHÔNG
 * mount `<ReactFlow>` (canvas thật, layout, viewport) — chỉ bọc trong
 * `<ReactFlowProvider>`, vốn chỉ là context Zustand nội bộ mà `<Handle>` cần
 * để không văng lỗi "Seems like you have not used ReactFlowProvider as an
 * ancestor" (đã đo bằng probe thật trước khi viết test này). Đây là mức bọc
 * NHẸ NHẤT có thể để component tự đứng được, không phải một cách né việc mount
 * React Flow.
 */
const renderInFlow = (ui: React.ReactElement) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>)

const BASE_DATA: FlowNodeData = {
  name: null, builder: 'launch', isSupervisor: false, phase: 'live',
  state: 'Active', cause: null, suspendReason: null, lastPrint: null, printCount: 0, isCurrent: false,
}

/** Phần còn lại của NodeProps mà React Flow tự điền lúc mount thật — ở đây điền tay vì test gọi component trực tiếp. */
function jobNodeProps(data: FlowNodeData): NodeProps<FlowNode> {
  return {
    id: 'n', data, type: 'job', dragging: false, zIndex: 0, selectable: true,
    deletable: true, selected: false, draggable: false, isConnectable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0,
  }
}

function scopeNodeProps(data: FlowNodeData): NodeProps<FlowNode> {
  return { ...jobNodeProps(data), type: 'scope' }
}

describe('JobNode (Task 13)', () => {
  it('hiện tên job làm nhãn', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, name: 'worker-1' })} />)
    expect(screen.getByText('worker-1')).toBeInTheDocument()
  })

  it('không có tên riêng thì dùng tên builder làm nhãn', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, name: null, builder: 'async' })} />)
    expect(screen.getByText('async')).toBeInTheDocument()
  })

  it('accent trái đổi theo builder — mỗi builder một màu token khác nhau', () => {
    const { unmount } = renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, builder: 'launch' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderLeftColor: builderAccent('launch') })
    unmount()

    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, builder: 'async' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderLeftColor: builderAccent('async') })
    expect(builderAccent('launch')).not.toBe(builderAccent('async'))
  })

  it("builder 'scope' (Task 5, M3) có token riêng — không rơi về --fg-dim, không trùng builder nào", () => {
    // Job gốc của CoroutineScope(ctx) là một node CÓ THẬT trên đồ thị từ Task 5.
    // Nếu quên thêm nó vào BUILDER_ACCENT thì builderAccent trả '--fg-dim' —
    // đúng cái màu dành cho "builder lạ chưa biết", nên node quan trọng nhất của
    // bài học Android lại hiện ra mờ như một thứ engine không nhận ra.
    expect(builderAccent('scope')).toBe('var(--k-scope)')
    expect(builderAccent('scope')).not.toBe('var(--fg-dim)')
    for (const b of ['runBlocking', 'launch', 'async', 'coroutineScope', 'supervisorScope', 'withContext']) {
      expect(builderAccent('scope'), `trùng màu với ${b}`).not.toBe(builderAccent(b))
    }
    // Và token phải TỒN TẠI. `var(--k-scope)` chưa khai thì trình duyệt bỏ qua
    // thuộc tính, node mất accent mà không có lỗi nào — sai âm thầm.
    // Đọc bằng node:fs từ cwd (cùng cách boundary.test.ts dựa vào cwd), KHÔNG
    // bằng `import ... ?raw`: workspace 'ui' đi qua Vite với css bị tắt, nên
    // import file .css trả về chuỗi RỖNG — test sẽ xanh/đỏ vì lý do sai.
    const tokensCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/tokens.css'), 'utf8')
    expect(tokensCss).toMatch(/--k-scope:\s*#[0-9a-fA-F]{3,8};/)
  })

  it('viền đổi theo state', () => {
    // Kiểm borderRightColor (không phải borderColor rút gọn): borderLeftColor
    // bị JobNode ghi đè riêng cho accent builder, nên bốn cạnh không còn đều
    // nhau — CSSOM trả rỗng cho shorthand 'border-color' khi các cạnh khác màu.
    // borderRightColor là cạnh KHÔNG bị ghi đè, phản ánh đúng màu theo state.
    const { unmount } = renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Active' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderRightColor: stateBorder('Active') })
    unmount()

    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Cancelled' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderRightColor: stateBorder('Cancelled') })
    expect(stateBorder('Active')).not.toBe(stateBorder('Cancelled'))
  })

  it('đang treo thì hiện huy hiệu suspend đúng lý do', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, suspendReason: 'delay' })} />)
    expect(screen.getByText('delay')).toBeInTheDocument()
  })

  it('không treo thì không có huy hiệu suspend', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, suspendReason: null })} />)
    expect(screen.queryByText('delay')).not.toBeInTheDocument()
    expect(screen.queryByText('join')).not.toBeInTheDocument()
    expect(screen.queryByText('await')).not.toBeInTheDocument()
  })

  it('unborn: không lộ nhãn dù data.name đã có sẵn, viền đứt + mờ', () => {
    renderInFlow(
      <JobNode {...jobNodeProps({ ...BASE_DATA, name: 'worker-1', phase: 'unborn', state: null })} />,
    )
    expect(screen.queryByText('worker-1')).not.toBeInTheDocument()
    const el = screen.getByTestId('job-node')
    expect(el.className).toContain('k-job-node--unborn')
    expect(el).toHaveAttribute('data-phase', 'unborn')
  })

  it('cause chỉ hiện khi state là Cancelling/Cancelled', () => {
    const { unmount } = renderInFlow(
      <JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Active', cause: 'IllegalStateException' })} />,
    )
    expect(screen.queryByText('IllegalStateException')).not.toBeInTheDocument()
    unmount()

    renderInFlow(
      <JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Cancelled', cause: 'IllegalStateException' })} />,
    )
    expect(screen.getByText('IllegalStateException')).toBeInTheDocument()
  })

  it('cause null thì không hiện gì kể cả khi Cancelled', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Cancelled', cause: null })} />)
    // Không có gì để khẳng định "có mặt" — khẳng định phủ định: node vẫn dựng
    // được, không ném, và không có phần tử k-job-node__cause nào xuất hiện.
    expect(document.querySelector('.k-job-node__cause')).toBeNull()
  })
})

describe('ScopeNode (Task 13)', () => {
  it('hiện tiêu đề theo tên hoặc builder', () => {
    renderInFlow(<ScopeNode {...scopeNodeProps({ ...BASE_DATA, builder: 'coroutineScope', name: null })} />)
    expect(screen.getByText('coroutineScope')).toBeInTheDocument()
  })

  it('supervisor dùng nét đôi, không-supervisor dùng nét đơn — phân biệt bằng hình dạng', () => {
    const { unmount } = renderInFlow(
      <ScopeNode {...scopeNodeProps({ ...BASE_DATA, isSupervisor: true, builder: 'supervisorScope' })} />,
    )
    expect(screen.getByTestId('scope-node').className).toContain('k-scope-node--supervisor')
    unmount()

    renderInFlow(<ScopeNode {...scopeNodeProps({ ...BASE_DATA, isSupervisor: false, builder: 'coroutineScope' })} />)
    expect(screen.getByTestId('scope-node').className).not.toContain('k-scope-node--supervisor')
  })

  it('unborn: không lộ tiêu đề', () => {
    renderInFlow(
      <ScopeNode {...scopeNodeProps({ ...BASE_DATA, name: 'scope-1', phase: 'unborn', state: null })} />,
    )
    expect(screen.queryByText('scope-1')).not.toBeInTheDocument()
  })
})
