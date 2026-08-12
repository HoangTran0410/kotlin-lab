import type { Edge, Node } from '@xyflow/react'
import type { JobState } from '../../engine/trace/events'
import type { GraphEdgeSpec, GraphSpec } from '../../engine/trace/graph'
import type { WorldState } from '../../engine/trace/world'
import type { LayoutResult } from './elkLayout'
import { phase, type Phase } from './nodeStyle'

export interface FlowNodeData extends Record<string, unknown> {
  /** The name the user gave it (`CoroutineName(...)`), or null. Displaying it is Task 13's job. */
  name: string | null
  /** The variable name the learner assigned this coroutine to (`val job = launch {}`). */
  varName: string | null
  builder: string
  isSupervisor: boolean
  phase: Phase
  /** null ⟺ not born yet (world.jobs doesn't have it). */
  state: JobState | null
  /** Only non-null when state ∈ {Cancelling, Cancelled} — locks down backlog item B4, see below. */
  cause: string | null
  /**
   * The message that came with `cause`, gated the same way. Populated even
   * for a job that never threw anything itself (dragged down by a sibling's
   * or a descendant's failure) — `failure` below is null in exactly that
   * case, so this is the only place such a node can get a message from.
   */
  causeMessage: string | null
  suspendReason: string | null
  /** The most recent println line printed by THIS node itself, and the total number of lines printed. */
  lastPrint: string | null
  printCount: number
  failure: { exType: string; message: string } | null
  /**
   * Which dispatcher this coroutine belongs to, and the thread it holds RIGHT
   * NOW (null while suspended — the thread went back to the pool).
   *
   * Neither reached the screen before: the engine models pools, acquire and
   * release carefully, and `threadId` was rendered nowhere in the UI at all.
   * So "withContext moved this coroutine to another pool" — the entire point
   * of the dispatcher lesson — showed up on the graph as nothing.
   */
  dispatcher: string | null
  threadId: string | null
  /** The node the step being viewed is TALKING ABOUT — drawn with an emphasis ring. */
  isCurrent: boolean
}

export type FlowNodeType = 'scope' | 'job'
export type FlowNode = Node<FlowNodeData, FlowNodeType>

export interface FlowEdgeData extends Record<string, unknown> {
  kind: GraphEdgeSpec['kind']
  /** Only meaningful when kind is 'failure' — see GraphEdgeSpec.blocked. */
  blocked: boolean
  /**
   * 0.18 when a 'child' edge points to a node that HASN'T been born yet
   * (matches the ghost opacity of an unborn node, Decision 2 option b); 1 in
   * every other case. failure/cancel edges only appear in the array AFTER
   * they've happened (see below), so they're always full opacity when present.
   */
  opacity: number
}
export type FlowEdge = Edge<FlowEdgeData>

export interface ReactFlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/**
 * A PURE function, the heart of the anti-jitter mechanism (Decision 2). Three
 * arguments in, React Flow nodes/edges out — no side effects, no async, no
 * touching the DOM.
 *
 * `position` COMES FROM `layout`, NEVER from `world`. This is the central
 * invariant of Decision 2: layout is computed once per compile, while `world`
 * changes on every step. Letting `world` touch coordinates makes the graph
 * jitter immediately — scrubbing through N steps means N layout jumps.
 *
 * A node that hasn't been born yet (not in `world.jobs`) is still EMITTED, as
 * a ghost (`data.phase === 'unborn'`). Dropping it would make React Flow
 * remove the node from the tree, and when it reappears React Flow would mount
 * a NEW node — losing the transition effect, and for a compound node its
 * children would be orphaned for one frame.
 *
 * State is read PER NODE from `world.jobs`. Child state is NEVER inferred
 * from the parent's state: backlog item M1 (A1) lets a parent emit
 * `Completed` BEFORE the child's `finally` finishes running, so "parent done
 * ⇒ child done" is WRONG on this trace. No collapsing, no fading the whole
 * subtree when the parent is Completed.
 *
 * The returned array's order PRESERVES `spec.nodes` (Task 4 already locked
 * down that a parent always comes before its children). This is mandatory:
 * React Flow reads `parentId` and positions a child RELATIVE TO its parent,
 * so if the parent appeared AFTER the child in the array, every nested node
 * would end up mispositioned — layoutGraph (Task 11) is completely
 * insensitive to this order (it builds the tree by looking up `parentId`), so
 * this is the ONLY layer left that can enforce it.
 */
export function toReactFlow(spec: GraphSpec, layout: LayoutResult, world: WorldState): ReactFlowGraph {
  const nodes: FlowNode[] = []
  const present = new Set<string>()

  for (const n of spec.nodes) {
    const box = layout.get(n.id)
    // Layout is missing a box for this node (e.g. elkLayout error / spec-layout
    // mismatch) — skip it, DON'T THROW. A node that can't be drawn is still
    // better than a broken graph.
    if (!box) continue

    const job = world.jobs.get(n.id)
    const ph = phase(n, world)
    const state: JobState | null = job?.state ?? null
    // B4: cause survives on the job across transitions that don't carry a
    // cause (foldTrace only overwrites it when e.cause is truthy). Only trust
    // it when state is currently Cancelling/Cancelled; for any other state,
    // treat cause as leftover garbage.
    const cause = job !== undefined && (job.state === 'Cancelling' || job.state === 'Cancelled')
      ? job.cause
      : null
    const causeMessage = job !== undefined && (job.state === 'Cancelling' || job.state === 'Cancelled')
      ? job.causeMessage
      : null

    const node: FlowNode = {
      id: n.id,
      type: n.isContainer ? 'scope' : 'job',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: {
        name: n.name,
        varName: n.varName,
        builder: n.builder,
        isSupervisor: n.isSupervisor,
        phase: ph,
        state,
        cause,
        causeMessage,
        suspendReason: job?.suspendReason ?? null,
        lastPrint: job?.lastPrint ?? null,
        printCount: job?.printCount ?? 0,
        failure: job?.failure ?? null,
        dispatcher: job?.dispatcher ?? null,
        threadId: job?.threadId ?? null,
        isCurrent: world.activeJobId === n.id,
      },
    }
    if (n.parentId !== null) {
      node.parentId = n.parentId
      node.extent = 'parent'
    }
    nodes.push(node)
    present.add(n.id)
  }

  // A failure/cancel edge has only "happened" (and is therefore only drawn)
  // when the event that produced it is no later than the last event applied
  // at the step being viewed.
  const lastSeq = world.lastEvent?.seq ?? -1

  const edges: FlowEdge[] = []
  for (const e of spec.edges) {
    // 'child' edges are NOT drawn. The parent-child relationship is already
    // expressed by the child node BEING INSIDE the parent box (`parentId` +
    // `extent: 'parent'` above) — drawing an extra arrow from the parent box
    // to something already inside it would be both redundant and the main
    // source of lines overlapping nodes: React Flow connects the parent's
    // bottom handle to the child's top handle, and since the child sits
    // INSIDE the parent, that line is forced to cut straight through the
    // box's body and through every sibling node in between. ELK also
    // deliberately doesn't accept this edge (see elkLayout.ts), so it has
    // never been routed — it would just be a bezier drawn blindly.
    if (e.kind === 'child') continue
    // A source/target node skipped above (missing box) means any edge
    // pointing to it is skipped too — React Flow won't accept an orphaned
    // edge.
    if (!present.has(e.source) || !present.has(e.target)) continue
    if (e.firstSeq > lastSeq) continue

    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      data: { kind: e.kind, blocked: e.blocked, opacity: 1 },
    })
  }

  return { nodes, edges }
}
