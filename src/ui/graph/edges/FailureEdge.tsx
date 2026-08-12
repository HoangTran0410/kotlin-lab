import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { FlowEdge } from '../toReactFlow'
import { edgeStyle } from './edgeStyle'
import '../graph.css'

/**
 * DEDICATED renderer for the 'failure' edge. Why it needs its own component
 * instead of just style on the Edge object (which is enough for
 * 'child'/'cancel'): the `blockedBySupervisor` case needs to draw a BLOCK MARK
 * — a solid crossbar at the arrow's tip, replacing the arrow — something
 * React Flow's standard SVG marker can't express, plus a label placed next to
 * it. This is exactly the lesson progress.md Task 13 talks about: without
 * `FAILURE_PROPAGATED.blockedBySupervisor` there's nothing to draw the
 * supervisor boundary with — here it's DATA (`data.blocked`), not a hardcoded
 * `block` op like the old HTML version.
 *
 * 'child' and 'cancel' DON'T need their own component: `edgeStyle()` supplies
 * enough stroke/dash/marker to set directly on the Edge object (see
 * GraphCanvas.tsx), and React Flow's default edge draws them correctly.
 */
export function FailureEdge({
  sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, markerEnd, style,
}: EdgeProps<FlowEdge>) {
  // Stepped path, not bezier: the failure edge runs inside the LANE along the
  // right edge (see NodePorts.tsx), and a free-form curve would bulge out of
  // that lane and cut through a node. `offset` matches the offset set for the
  // other edges in GraphCanvas, so both edge kinds sit the same distance from
  // the box.
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    offset: 28, borderRadius: 10,
  })
  const blocked = data?.blocked ?? false
  const opacity = data?.opacity ?? 1
  const visual = edgeStyle('failure', blocked)

  return (
    <>
      <BaseEdge
        path={path}
        // Blocked -> no arrow gets through anymore (see edgeStyle.ts markerVariant).
        markerEnd={visual.markerVariant === 'arrow' ? markerEnd : undefined}
        style={{ ...style, stroke: visual.stroke, strokeWidth: visual.strokeWidth, opacity }}
      />
      {visual.markerVariant === 'block' && (
        <EdgeLabelRenderer>
          <div
            className="k-edge-block-mark"
            style={{ transform: `translate(-50%, -50%) translate(${targetX}px, ${targetY}px)`, opacity }}
          />
          <div
            className="k-edge-block-label"
            style={{ transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY}px)`, opacity }}
          >
            {visual.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
