import { Handle, Position } from '@xyflow/react'

/**
 * Edge connection points, shared by JobNode and ScopeNode.
 *
 * Two separate lanes for the two propagation directions, and that's a
 * TEACHING decision, not decoration:
 *
 *   - failure goes UP (child → parent), runs along the RIGHT edge
 *   - cancel goes DOWN (parent → child), runs along the LEFT edge
 *
 * The first version connected every edge to the top/bottom handle in the
 * middle of the box. With a nested graph, a failure edge from a
 * deeply-nested node up to an ancestor has to go against the layout direction
 * (ELK lays out DOWN), so React Flow would drag a bezier curve back around
 * through everything in the way — namely, sibling nodes. Splitting the two
 * directions onto two edges means they never overlap, and a learner can read
 * the propagation direction just by seeing which side the line runs on.
 *
 * The left/right `CONTAINER_PADDING` (dimensions.ts) already reserves room
 * for these two lanes inside each scope.
 *
 * Every handle is hidden (graph.css): this tool is READ-ONLY, dragging to
 * connect new edges isn't supported, so exposing the drag dots would suggest
 * an interaction that doesn't exist.
 */
export function NodePorts() {
  return (
    <>
      <Handle id="in" type="target" position={Position.Top} />
      <Handle id="out" type="source" position={Position.Bottom} />
      <Handle id="fail-out" type="source" position={Position.Right} />
      <Handle id="fail-in" type="target" position={Position.Right} />
      <Handle id="cancel-out" type="source" position={Position.Left} />
      <Handle id="cancel-in" type="target" position={Position.Left} />
    </>
  )
}
