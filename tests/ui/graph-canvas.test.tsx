import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { GraphCanvas } from '../../src/ui/graph/GraphCanvas'
import type { FlowNode } from '../../src/ui/graph/toReactFlow'

/**
 * GraphCanvas has no dedicated test in the Task 13 brief (the brief only
 * asks for 6 tests rendering individual nodes, "without mounting the whole
 * React Flow") — but this is the ONLY layer that actually mounts
 * `<ReactFlow>`, and it's where a "recompute position per step" bug (the
 * thing Decision 2, Task 11/12, forbids) could slip in unnoticed, because
 * `toReactFlow` (Task 12) only locks down the invariant at its OWN OUTPUT —
 * it can't lock down whether the layer AFTER it (here) respects that output
 * or not. The tests below mount GraphCanvas FOR REAL to lock down exactly
 * that spot.
 *
 * Edge color/stroke isn't checked here: @xyflow/react measures handle
 * position with a real getBoundingClientRect, jsdom doesn't do layout so
 * handle bounds never initialize and edges don't render — exactly the
 * boundary tests/ui/setup.ts already notes (real layout is checked in Task
 * 20, Playwright). `edgeStyle()` itself is already fully, purely locked down
 * in tests/ui/edge-style.test.ts.
 */
function job(id: string, x: number, y: number): FlowNode {
  return {
    id, type: 'job', position: { x, y }, width: 200, height: 68,
    data: {
      name: id, builder: 'launch', isSupervisor: false, phase: 'live',
      state: 'Active', cause: null, causeMessage: null, varName: null, suspendReason: null, lastPrint: null, printCount: 0, failure: null, dispatcher: 'Main', threadId: null, isCurrent: false,
    },
  }
}

describe('GraphCanvas (Task 13) — where the real React Flow gets mounted', () => {
  it('rendered position MATCHES the position passed in — no recomputation (locks down Decision 2 at the mount layer)', () => {
    const nodes = [job('a', 10, 20), job('b', 240, 88)]
    // Edges are NOT empty — if left empty, a hidden position transform that
    // depends on edges.length (as sabotage measured above) would accidentally
    // come out as 0 and this test would go green for the wrong reason,
    // without actually locking down what it claims to.
    const edges = [
      { id: 'e1', source: 'a', target: 'b', data: { kind: 'child' as const, blocked: false, opacity: 1 } },
    ]
    const { container } = render(<GraphCanvas nodes={nodes} edges={edges} />)

    const a = container.querySelector<HTMLElement>('[data-id="a"]')
    const b = container.querySelector<HTMLElement>('[data-id="b"]')
    expect(a?.style.transform).toBe('translate(10px,20px)')
    expect(b?.style.transform).toBe('translate(240px,88px)')
  })

  it("position doesn't change between two renders with the same input — no hidden transform keyed on edges", () => {
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

  it('node type "job" renders via JobNode, "scope" renders via ScopeNode — correct nodeTypes', () => {
    const scope: FlowNode = { ...job('s', 0, 0), type: 'scope' }
    const { container } = render(<GraphCanvas nodes={[job('a', 0, 0), scope]} edges={[]} />)

    expect(container.querySelector('[data-id="a"] .k-job-node')).not.toBeNull()
    expect(container.querySelector('[data-id="a"] .k-scope-node')).toBeNull()
    expect(container.querySelector('[data-id="s"] .k-scope-node')).not.toBeNull()
    expect(container.querySelector('[data-id="s"] .k-job-node')).toBeNull()
  })
})
