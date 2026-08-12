import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { GraphSpec } from '../../engine/trace/graph'
import { NODE_W, NODE_H, CONTAINER_PADDING } from './dimensions'

export interface Box { x: number; y: number; width: number; height: number }
export type LayoutResult = ReadonlyMap<string, Box>

const elk = new ELK()

const OPTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '32',
  // Bố cục con NẰM TRONG cha (compound thật sự), không đặt cạnh nhau.
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.padding': `[top=${CONTAINER_PADDING.top},left=${CONTAINER_PADDING.left},` +
                 `bottom=${CONTAINER_PADDING.bottom},right=${CONTAINER_PADDING.right}]`,
}

/**
 * Chạy ĐÚNG MỘT LẦN cho mỗi lần compile, không phải một lần mỗi step. Kéo
 * scrubber không bao giờ chạm tới hàm này (xem Task 15).
 *
 * Cạnh 'child' KHÔNG đưa vào ELK dưới dạng edge — quan hệ cha-con đã nằm ở
 * cây `children`. Đưa vào nữa thì ELK vẽ thêm một mũi tên từ hộp cha tới node
 * nằm bên trong chính nó.
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
