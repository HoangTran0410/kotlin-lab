import { type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../toReactFlow'
import { jobLabel } from '../../../engine/trace/label'
import { builderAccent, stateBorder } from '../nodeStyle'
import { NodePorts } from './NodePorts'
import '../graph.css'

/**
 * A leaf node (`launch`/`async`/... with no children). LEFT accent by builder
 * (the color meaning "this is a launch/async/..."), border BY STATE (the
 * color meaning "where it is in the job lifecycle"), a suspend badge when the
 * job is suspended, the job name.
 *
 * `unborn` (its COROUTINE_CREATED hasn't happened at the step being viewed —
 * see nodeStyle.ts `phase()`): dashed border + fully faded (graph.css
 * `--unborn`), and ALL content HIDDEN — including the name, even though
 * `data.name` is already available at compile time (the name is a STATIC
 * property of the spec, independent of step). Revealing the name early would
 * "spoil" the content of a step the scrubber hasn't reached yet, defeating
 * the point of the ghosting.
 */
export function JobNode({ id, data }: NodeProps<FlowNode>) {
  const unborn = data.phase === 'unborn'
  // Locks down backlog item B4 (see toReactFlow.ts): data.cause is already
  // gated at the data layer (null unless state ∈ {Cancelling, Cancelled}),
  // but JobNode re-checks state HERE too — defense in depth, not relying
  // entirely on upstream.
  const showCause = data.cause !== null && (data.state === 'Cancelling' || data.state === 'Cancelled')
  const border = data.state ? stateBorder(data.state) : 'var(--fg-dim)'
  const label = jobLabel({ id, builder: data.builder, name: data.name, varName: data.varName })

  return (
    <div
      className={[
        'k-job-node',
        unborn ? 'k-job-node--unborn' : '',
        data.isCurrent && !unborn ? 'k-job-node--current' : '',
      ].filter(Boolean).join(' ')}
      // Four explicit longhands, NOT the `borderColor` shorthand combined with
      // `borderLeftColor`: when mixed together in ONE style object, some
      // CSSOM engines (measured in jsdom, used for tests) treat the four
      // sides as "not uniform" and drop the rest entirely instead of
      // splitting into four longhands — the state border disappears from the
      // `style` attribute. Writing it out explicitly avoids depending on that
      // implicit behavior.
      style={{
        borderTopColor: border, borderRightColor: border, borderBottomColor: border,
        borderLeftColor: builderAccent(data.builder),
      }}
      data-testid="job-node"
      data-phase={data.phase}
    >
      <NodePorts />
      {!unborn && (
        <>
          <span className="k-job-node__head">
            <span className="k-job-node__name">{label}</span>
            {/* Builder must still be readable when the label is a variable
                name: `job` doesn't tell anyone whether it's launch or async,
                and that difference is the lesson. */}
            {label !== data.builder && (
              <span className="k-job-node__builder">{data.builder}</span>
            )}
            {/* Id always shown, even once a CoroutineName exists. Three
                sibling `launch`es all showing the same word "launch" gives no
                way to tell which is which — and the narration below the
                graph refers to jobs by exactly this id, so dropping it cuts
                the bridge between the text and the drawing. */}
            <span className="k-job-node__id">{id}</span>
          </span>
          <span className="k-job-node__row">
            {data.suspendReason !== null && <span className="k-job-node__badge">{data.suspendReason}</span>}
            {/* Which thread this coroutine is on, or which pool it belongs to
                while it holds none. Before this the whole dispatcher dimension
                was invisible on the graph — `threadId` was rendered nowhere in
                the UI at all, so `withContext(Dispatchers.IO)` looked like
                nothing happened.

                Suspended shows the POOL greyed out, not a blank: "it belongs
                to IO but is holding no thread right now" is precisely the
                lesson, and an empty space says nothing at all. */}
            {data.dispatcher !== null && (
              <span
                className={`k-job-node__thread k-job-node__thread--${data.dispatcher}${
                  data.threadId === null ? ' k-job-node__thread--idle' : ''}`}
                title={data.threadId !== null
                  ? `running on thread ${data.threadId}`
                  : `belongs to ${data.dispatcher}, holding no thread right now`}
              >
                {data.threadId ?? `${data.dispatcher} · —`}
              </span>
            )}
          </span>
          {/* The exception's message, not just its type. A bare
              `RuntimeException` isn't debuggable — two different throw sites
              look identical. The message only exists on EXCEPTION_THROWN, so
              previously reading it meant scrubbing to hit exactly ONE event.
              `causeMessage` carries it even onto a job that never threw
              anything itself — an innocent sibling dragged down by
              `cancelJob`, or an ancestor a failure climbed through — because
              the learner still benefits from seeing WHY the whole subtree
              died, not just that it did. */}
          {showCause && (
            <span className="k-job-node__cause" title={data.causeMessage ? `${data.cause}: ${data.causeMessage}` : data.cause ?? ''}>
              {data.cause}
              {data.causeMessage && data.causeMessage !== '' && (
                <span className="k-job-node__msg">: {data.causeMessage}</span>
              )}
            </span>
          )}
          {/* println shows up RIGHT ON the node that printed it. Previously
              the text only went to the side console panel, so looking at the
              graph you couldn't tell which node printed — you had to glance
              elsewhere and piece it together yourself. */}
          {data.lastPrint !== null && (
            <span className="k-job-node__print" title={data.lastPrint}>
              <span className="k-job-node__print-mark">»</span>
              {data.lastPrint}
              {data.printCount > 1 && <span className="k-job-node__print-n">+{data.printCount - 1}</span>}
            </span>
          )}
        </>
      )}
    </div>
  )
}
