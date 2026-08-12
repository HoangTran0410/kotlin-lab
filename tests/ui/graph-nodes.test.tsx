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
 * Renders "individual nodes, without mounting the whole React Flow" (brief
 * Task 13 step 4): does NOT mount `<ReactFlow>` (the real canvas, layout,
 * viewport) — just wraps in `<ReactFlowProvider>`, which is only the internal
 * Zustand context `<Handle>` needs so it doesn't throw "Seems like you have
 * not used ReactFlowProvider as an ancestor" (measured with a real probe
 * before writing this test). This is the LIGHTEST possible wrapping needed
 * for the component to stand on its own, not a way to dodge mounting React
 * Flow.
 */
const renderInFlow = (ui: React.ReactElement) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>)

const BASE_DATA: FlowNodeData = {
  name: null, builder: 'launch', isSupervisor: false, phase: 'live',
  state: 'Active', cause: null, causeMessage: null, varName: null, suspendReason: null, lastPrint: null, printCount: 0, failure: null, dispatcher: 'Main', threadId: null, isCurrent: false,
}

/** The rest of NodeProps that React Flow fills in automatically on a real mount — filled in by hand here since the test calls the component directly. */
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
  it('shows the job name as the label', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, name: 'worker-1' })} />)
    expect(screen.getByText('worker-1')).toBeInTheDocument()
  })

  it('falls back to the builder name as the label when there is no name', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, name: null, builder: 'async' })} />)
    expect(screen.getByText('async')).toBeInTheDocument()
  })

  it('left accent changes by builder — each builder a different color token', () => {
    const { unmount } = renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, builder: 'launch' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderLeftColor: builderAccent('launch') })
    unmount()

    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, builder: 'async' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderLeftColor: builderAccent('async') })
    expect(builderAccent('launch')).not.toBe(builderAccent('async'))
  })

  it("builder 'scope' (Task 5, M3) has its own token — doesn't fall back to --fg-dim, doesn't collide with any builder", () => {
    // The root job of CoroutineScope(ctx) is a REAL node on the graph since
    // Task 5. Forgetting to add it to BUILDER_ACCENT would make builderAccent
    // return '--fg-dim' — exactly the color meant for "unknown builder", so
    // the most important node of the Android lesson would show up faded as
    // if the engine didn't recognize it.
    expect(builderAccent('scope')).toBe('var(--k-scope)')
    expect(builderAccent('scope')).not.toBe('var(--fg-dim)')
    for (const b of ['runBlocking', 'launch', 'async', 'coroutineScope', 'supervisorScope', 'withContext']) {
      expect(builderAccent('scope'), `collides with the color of ${b}`).not.toBe(builderAccent(b))
    }
    // And the token must EXIST. If `var(--k-scope)` isn't declared yet, the
    // browser ignores the property, the node loses its accent with no error
    // at all — a silent failure.
    // Read with node:fs from cwd (same approach boundary.test.ts relies on),
    // NOT with `import ... ?raw`: workspace 'ui' goes through Vite with css
    // disabled, so importing a .css file returns an EMPTY string — the test
    // would pass/fail for the wrong reason.
    const tokensCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/tokens.css'), 'utf8')
    expect(tokensCss).toMatch(/--k-scope:\s*#[0-9a-fA-F]{3,8};/)
  })

  it('border changes by state', () => {
    // Check borderRightColor (not the shorthand borderColor): borderLeftColor
    // is overridden separately by JobNode for the builder accent, so the four
    // sides are no longer uniform — CSSOM returns empty for the 'border-color'
    // shorthand when the sides have different colors. borderRightColor is the
    // side that ISN'T overridden, so it reflects the correct state color.
    const { unmount } = renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Active' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderRightColor: stateBorder('Active') })
    unmount()

    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Cancelled' })} />)
    expect(screen.getByTestId('job-node')).toHaveStyle({ borderRightColor: stateBorder('Cancelled') })
    expect(stateBorder('Active')).not.toBe(stateBorder('Cancelled'))
  })

  it('shows a suspend badge with the right reason while suspended', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, suspendReason: 'delay' })} />)
    expect(screen.getByText('delay')).toBeInTheDocument()
  })

  it('shows no suspend badge while not suspended', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, suspendReason: null })} />)
    expect(screen.queryByText('delay')).not.toBeInTheDocument()
    expect(screen.queryByText('join')).not.toBeInTheDocument()
    expect(screen.queryByText('await')).not.toBeInTheDocument()
  })

  it('unborn: label stays hidden even though data.name is already set, dashed + faded border', () => {
    renderInFlow(
      <JobNode {...jobNodeProps({ ...BASE_DATA, name: 'worker-1', phase: 'unborn', state: null })} />,
    )
    expect(screen.queryByText('worker-1')).not.toBeInTheDocument()
    const el = screen.getByTestId('job-node')
    expect(el.className).toContain('k-job-node--unborn')
    expect(el).toHaveAttribute('data-phase', 'unborn')
  })

  it('cause only shows when state is Cancelling/Cancelled', () => {
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

  it('cause null shows nothing even when Cancelled', () => {
    renderInFlow(<JobNode {...jobNodeProps({ ...BASE_DATA, state: 'Cancelled', cause: null })} />)
    // Nothing to assert as "present" — assert the negative instead: the node
    // still renders, doesn't throw, and no k-job-node__cause element appears.
    expect(document.querySelector('.k-job-node__cause')).toBeNull()
  })

  it('shows the causing message from causeMessage even when this job has no failure of its own (an ancestor the failure climbed through)', () => {
    renderInFlow(<JobNode {...jobNodeProps({
      ...BASE_DATA, state: 'Cancelled', cause: 'RuntimeException', causeMessage: 'boom', failure: null,
    })} />)
    expect(screen.getByText(': boom')).toBeInTheDocument()
  })
})

describe('ScopeNode (Task 13)', () => {
  it('shows the title from name or builder', () => {
    renderInFlow(<ScopeNode {...scopeNodeProps({ ...BASE_DATA, builder: 'coroutineScope', name: null })} />)
    expect(screen.getByText('coroutineScope')).toBeInTheDocument()
  })

  it('supervisor uses a double border, non-supervisor uses a single border — distinguished by shape', () => {
    const { unmount } = renderInFlow(
      <ScopeNode {...scopeNodeProps({ ...BASE_DATA, isSupervisor: true, builder: 'supervisorScope' })} />,
    )
    expect(screen.getByTestId('scope-node').className).toContain('k-scope-node--supervisor')
    unmount()

    renderInFlow(<ScopeNode {...scopeNodeProps({ ...BASE_DATA, isSupervisor: false, builder: 'coroutineScope' })} />)
    expect(screen.getByTestId('scope-node').className).not.toContain('k-scope-node--supervisor')
  })

  it('unborn: title stays hidden', () => {
    renderInFlow(
      <ScopeNode {...scopeNodeProps({ ...BASE_DATA, name: 'scope-1', phase: 'unborn', state: null })} />,
    )
    expect(screen.queryByText('scope-1')).not.toBeInTheDocument()
  })

  it('cause only shows when state is Cancelling/Cancelled', () => {
    // Same rule as JobNode: a container (coroutineScope, an ordinary launch
    // with children, ...) can die too, and its border already turns red —
    // but without this, its box gives NO textual reason at all, not even
    // the bare exception type.
    const { unmount } = renderInFlow(
      <ScopeNode {...scopeNodeProps({ ...BASE_DATA, state: 'Active', cause: 'RuntimeException' })} />,
    )
    expect(screen.queryByText('RuntimeException')).not.toBeInTheDocument()
    unmount()

    renderInFlow(
      <ScopeNode {...scopeNodeProps({ ...BASE_DATA, state: 'Cancelled', cause: 'RuntimeException' })} />,
    )
    expect(screen.getByText('RuntimeException')).toBeInTheDocument()
  })

  it('shows the causing message alongside the type when present', () => {
    renderInFlow(<ScopeNode {...scopeNodeProps({
      ...BASE_DATA, state: 'Cancelled', cause: 'RuntimeException', causeMessage: 'boom', failure: null,
    })} />)
    expect(screen.getByText(': boom')).toBeInTheDocument()
  })
})
