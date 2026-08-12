import { type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../toReactFlow'
import { jobLabel } from '../../../engine/trace/label'
import { stateBorder } from '../nodeStyle'
import { NodePorts } from './NodePorts'
import '../graph.css'

/**
 * Compound node (has children) — a transparent box wrapping child nodes, only
 * a title, no fill. Border colored BY STATE like JobNode (same `stateBorder`
 * source, so "running/done/cancelled" reads consistently on both node kinds).
 *
 * `isSupervisor` changes the border STYLE (double instead of single), not
 * just the color — brief Task 13 step 2 requires this to be explicit:
 * distinguish supervisors by SHAPE, because the supervisor boundary is the
 * single most important lesson this tool teaches (see FailureEdge.tsx) and
 * must not be lost on a black-and-white printout or for a colorblind learner.
 */
export function ScopeNode({ id, data }: NodeProps<FlowNode>) {
  const unborn = data.phase === 'unborn'
  const classes = ['k-scope-node']
  if (data.isSupervisor) classes.push('k-scope-node--supervisor')
  if (unborn) classes.push('k-scope-node--unborn')
  if (data.isCurrent && !unborn) classes.push('k-scope-node--current')
  // Same gating as JobNode: a container can die too (border already turns
  // red), but without this its box gave no textual reason at all — not even
  // the bare exception type, let alone the message.
  const showCause = data.cause !== null && (data.state === 'Cancelling' || data.state === 'Cancelled')

  return (
    <div
      className={classes.join(' ')}
      style={{ borderColor: data.state ? stateBorder(data.state) : 'var(--fg-dim)' }}
      data-testid="scope-node"
      data-phase={data.phase}
    >
      <NodePorts />
      {!unborn && (
        <>
          <div className="k-scope-node__title">
            {jobLabel({ id, builder: data.builder, name: data.name, varName: data.varName })}
            <span className="k-scope-node__id">{id}</span>
            {data.isSupervisor && <span className="k-scope-node__tag">supervisor</span>}
            {data.lastPrint !== null && (
              <span className="k-scope-node__print" title={data.lastPrint}>» {data.lastPrint}</span>
            )}
          </div>
          {showCause && (
            <span className="k-job-node__cause" title={data.causeMessage ? `${data.cause}: ${data.causeMessage}` : data.cause ?? ''}>
              {data.cause}
              {data.causeMessage && data.causeMessage !== '' && (
                <span className="k-job-node__msg">: {data.causeMessage}</span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  )
}
