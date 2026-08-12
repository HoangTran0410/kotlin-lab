import type { ELK, ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { GraphSpec } from '../../engine/trace/graph'
import { NODE_W, NODE_H, CONTAINER_PADDING } from './dimensions'

export interface Box { x: number; y: number; width: number; height: number }
export type LayoutResult = ReadonlyMap<string, Box>

// elkjs alone renders to ~1.5MB (the single biggest dependency in the app,
// bigger than React + CodeMirror + React Flow combined) — importing it
// statically would put its full weight in the bundle the browser must parse
// before the editor is even interactive. Dynamic import splits it into its
// own chunk, fetched lazily and cached here after the first layout.
let elkPromise: Promise<ELK> | undefined

async function getElk(): Promise<ELK> {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk())
  }
  return elkPromise
}

const OPTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  // Much more spacious than the initial layout (48/32). This graph is meant
  // to be READ SITTING DOWN, not squeezed to fit a screen: nodes touching each
  // other means the eye can't separate the job tree, and failure/cancel edges
  // have nowhere left to loop through without cutting across a node.
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.nodeNode': '48',
  'elk.spacing.edgeNode': '28',
  'elk.spacing.edgeEdge': '20',
  // Children laid out INSIDE the parent (true compound), not placed side by side.
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.padding': `[top=${CONTAINER_PADDING.top},left=${CONTAINER_PADDING.left},` +
                 `bottom=${CONTAINER_PADDING.bottom},right=${CONTAINER_PADDING.right}]`,
}

/**
 * Runs EXACTLY ONCE per compile, not once per step. Dragging the scrubber
 * never touches this function (see Task 15).
 *
 * 'child' edges are NOT fed into ELK as edges — the parent-child relationship
 * already lives in the `children` tree. Feeding them in too would make ELK
 * draw an extra arrow from the parent box to a node that's already inside it.
 */
export async function layoutGraph(spec: GraphSpec): Promise<LayoutResult> {
  if (spec.nodes.length === 0) return new Map()

  const kids = new Map<string | null, typeof spec.nodes>()
  for (const n of spec.nodes) {
    const k = kids.get(n.parentId) ?? []
    k.push(n)
    kids.set(n.parentId, k)
  }

  const build = (parentId: string | null): ElkNode[] =>
    (kids.get(parentId) ?? []).map(n => {
      const children = build(n.id)
      return children.length > 0
        ? { id: n.id, children, layoutOptions: OPTS }
        : { id: n.id, width: NODE_W, height: NODE_H }
    })

  const root: ElkNode = {
    id: 'root',
    layoutOptions: OPTS,
    children: build(null),
    edges: spec.edges
      .filter(e => e.kind !== 'child')
      .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const elk = await getElk()
  const out = await elk.layout(root)
  const boxes = new Map<string, Box>()
  const walk = (n: ElkNode): void => {
    if (n.id !== 'root') {
      boxes.set(n.id, {
        x: n.x ?? 0, y: n.y ?? 0,
        width: n.width ?? NODE_W, height: n.height ?? NODE_H,
      })
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(out)
  return boxes
}
