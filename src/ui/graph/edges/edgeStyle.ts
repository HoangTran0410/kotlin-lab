import type { GraphEdgeSpec } from '../../../engine/trace/graph'

/**
 * 'none'  — the 'child' edge: a containment relationship, not an action, so
 *           it needs no directional arrow.
 * 'arrow' — a regular arrow, at the TARGET end (React Flow places the marker
 *           on the target). cancel: target = the job being cancelled (always
 *           BELOW the job that cancels it in the tree, ELK layout direction
 *           DOWN) -> the arrow naturally points DOWN.
 *           failure: target = the PARENT job receiving the exception
 *           (FAILURE_PROPAGATED goes from child up to parent, see
 *           propagation.ts) -> the arrow naturally points UP.
 * 'block' — replaces the arrow with a block mark (a solid crossbar):
 *           the supervisor blocked the failure here, so there's nothing
 *           "getting through" for an arrow to draw anymore.
 */
export type EdgeMarkerVariant = 'none' | 'arrow' | 'block'

export interface EdgeVisual {
  stroke: string
  strokeWidth: number
  /** SVG stroke-dasharray. undefined ⟺ solid line. */
  strokeDasharray?: string
  markerVariant: EdgeMarkerVariant
  /** The label shown next to the edge. Only present when blocked by a supervisor. */
  label?: string
}

const CHILD_STYLE: EdgeVisual = { stroke: 'var(--fg-dim)', strokeWidth: 1, markerVariant: 'none' }
const CANCEL_STYLE: EdgeVisual = {
  stroke: 'var(--edge-cancel)', strokeWidth: 2, strokeDasharray: '6 4', markerVariant: 'arrow',
}
const FAILURE_STYLE: EdgeVisual = { stroke: 'var(--state-cancelled)', strokeWidth: 2, markerVariant: 'arrow' }
const FAILURE_BLOCKED_STYLE: EdgeVisual = {
  ...FAILURE_STYLE,
  markerVariant: 'block',
  label: 'blocked by supervisor',
}

/**
 * PURE mapping from kind + blocked -> edge shape. No React, no DOM —
 * GraphCanvas (for 'child'/'cancel' edges, using React Flow's default edge)
 * and FailureEdge (for 'failure' edges) both call this function, so both
 * places always draw in agreement instead of each picking its own colors.
 *
 * `blocked` ONLY matters when `kind === 'failure'` — 'child' and 'cancel'
 * ignore this parameter entirely. This matches the source data: buildGraphSpec
 * (Task 4) only ever assigns a real `blockedBySupervisor` to 'failure' edges;
 * 'child'/'cancel' edges are always created with `blocked: false` hardcoded
 * (see graph.ts).
 */
export function edgeStyle(kind: GraphEdgeSpec['kind'], blocked: boolean): EdgeVisual {
  switch (kind) {
    case 'child': return CHILD_STYLE
    case 'cancel': return CANCEL_STYLE
    case 'failure': return blocked ? FAILURE_BLOCKED_STYLE : FAILURE_STYLE
  }
}
