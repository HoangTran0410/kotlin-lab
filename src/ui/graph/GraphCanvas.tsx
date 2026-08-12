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

// CONSTANTS OUTSIDE the component (brief Task 13 step 3): if nodeTypes/edgeTypes
// were literals declared inline in JSX, React Flow would treat that as a new
// "type" on EVERY render (reference comparison) and remount the entire node/edge
// tree — exactly the kind of jitter Decision 2 (Task 11/12) exists to block,
// just at the React Flow node-identity layer instead of at coordinates.
const NODE_TYPES: NodeTypes = { job: JobNode, scope: ScopeNode }
const EDGE_TYPES: EdgeTypes = { failure: FailureEdge }

const FALLBACK_EDGE_DATA: FlowEdgeData = { kind: 'child', blocked: false, opacity: 1 }
const FIT_VIEW = { padding: 0.18, maxZoom: 1 }

/**
 * Mounts the real `<ReactFlow>`. `nodes`/`edges` come straight from
 * `toReactFlow` (Task 12) — a PURE function with no dependency on the
 * @xyflow/react runtime — so this component must NOT RECOMPUTE `position` in
 * any form; `nodes` are passed through UNCHANGED.
 *
 * `edges`, though, get their display shape attached here (Task 14):
 * `toReactFlow` returns PURE edges (only `data.kind`/`data.blocked`/
 * `data.opacity`), carrying none of React Flow's own style (markerEnd,
 * stroke...) — that's this DISPLAY LAYER's job, via `edgeStyle()`, so that
 * `toReactFlow` stays a pure function with no dependency on the @xyflow/react
 * runtime. Only the 'failure' edge needs its own component (FailureEdge, to
 * draw the block mark when `blockedBySupervisor`); 'child' and 'cancel' use
 * React Flow's default edge with style/markerEnd set directly on the Edge
 * object.
 */
export function GraphCanvas({ nodes, edges }: ReactFlowGraph) {
  const rfEdges = useMemo<Edge[]>(() => edges.map(e => {
    const d = e.data ?? FALLBACK_EDGE_DATA
    const visual = edgeStyle(d.kind, d.blocked)
    // Two lanes kept fully separate (see NodePorts.tsx): failure climbs the
    // RIGHT edge, cancel runs down the LEFT edge. This keeps the two
    // propagation directions from ever overlapping, and from cutting through
    // the node column in the middle.
    const right = d.kind === 'failure'
    return {
      ...e,
      type: d.kind === 'failure' ? 'failure' : 'smoothstep',
      sourceHandle: right ? 'fail-out' : 'cancel-out',
      targetHandle: right ? 'fail-in' : 'cancel-in',
      // Elbow pushed away from the box: the loop runs well outside the edge
      // instead of hugging the border and cutting into the neighboring node.
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
      // Leave a margin around the graph when auto-fitting: fitView flush to
      // the edge clips labels and the two side loops at the canvas rim.
      fitView
      fitViewOptions={FIT_VIEW}
      minZoom={0.2}
    >
      <Background gap={24} size={1} color="var(--border)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
