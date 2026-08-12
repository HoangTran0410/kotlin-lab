import type { Event, JobId } from './events'

export interface GraphNodeSpec {
  id: JobId
  parentId: JobId | null
  builder: string
  /** Container ⟺ has ≥1 child. NOT inferred from builder: launch/async can have children too. */
  isContainer: boolean
  isSupervisor: boolean
  name: string | null
  /** Variable name the learner assigns this coroutine to. See Event COROUTINE_CREATED. */
  varName: string | null
  dispatcher: string
  /** seq of the COROUTINE_CREATED. The UI uses this to know at which step the node was "born". */
  bornAt: number
}

export interface GraphEdgeSpec {
  id: string
  source: JobId
  target: JobId
  kind: 'child' | 'failure' | 'cancel'
  /** Only meaningful for kind 'failure'. */
  blocked: boolean
  /** seq of the first event that produced this edge. */
  firstSeq: number
}

export interface GraphSpec {
  nodes: GraphNodeSpec[]
  edges: GraphEdgeSpec[]
}

/**
 * Graph skeleton, derived from the WHOLE trace — deliberately takes no `upTo`.
 *
 * Why not build the graph from `foldTrace(events, n)`: the set of jobs grows
 * step by step, so ELK would receive a different graph at every step and
 * return different coordinates. Every existing node would jump to a new spot
 * each time a new node is born — scrubbing would be impossible.
 *
 * Separates shape (this function, invariant) from state (`foldTrace`,
 * per-step). ELK runs once per compile; scrubbing only changes what's
 * highlighted, never where anything sits.
 *
 * Safe because `foldTrace` only ADDS jobs, never removes them — the node set
 * grows monotonically, so the full set is the union of every intermediate set.
 */
export function buildGraphSpec(events: readonly Event[]): GraphSpec {
  const nodes: GraphNodeSpec[] = []
  const byId = new Map<JobId, GraphNodeSpec>()
  const edges: GraphEdgeSpec[] = []
  const edgeSeen = new Set<string>()

  const addEdge = (
    source: JobId, target: JobId, kind: GraphEdgeSpec['kind'], blocked: boolean, firstSeq: number,
  ): void => {
    const id = `${kind}:${source}->${target}`
    // Collapse repeats: the same pair can be emitted multiple times in the
    // trace (e.g. cancel propagating down and then propagating again). An
    // edge is a relationship, not an occurrence.
    if (edgeSeen.has(id)) return
    edgeSeen.add(id)
    edges.push({ id, source, target, kind, blocked, firstSeq })
  }

  for (const e of events) {
    switch (e.k) {
      case 'COROUTINE_CREATED': {
        const n: GraphNodeSpec = {
          id: e.id, parentId: e.parentId, builder: e.builder, isContainer: false,
          isSupervisor: e.ctx.isSupervisor, name: e.ctx.name, varName: e.varName ?? null,
          dispatcher: e.ctx.dispatcher, bornAt: e.seq,
        }
        // Insertion order = COROUTINE_CREATED order = parent always before
        // child, since a child can't be created before its parent exists.
        // React Flow requires exactly this.
        nodes.push(n)
        byId.set(e.id, n)
        const parent = e.parentId === null ? undefined : byId.get(e.parentId)
        if (parent) {
          parent.isContainer = true
          addEdge(parent.id, e.id, 'child', false, e.seq)
        }
        break
      }
      case 'FAILURE_PROPAGATED':
        // Can point at a node that's ALREADY Cancelled (M1 leftover). Still
        // drawn: it describes a structural reachability relationship, not a
        // live state.
        addEdge(e.from, e.to, 'failure', e.blockedBySupervisor, e.seq)
        break
      case 'CANCEL_REQUESTED':
        if (e.from !== 'user') addEdge(e.from, e.to, 'cancel', false, e.seq)
        break
      default:
        break
    }
  }

  return { nodes, edges }
}
