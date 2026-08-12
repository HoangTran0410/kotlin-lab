import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'
import { buildGraphSpec, type GraphSpec } from '../../src/engine/trace/graph'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { layoutGraph } from '../../src/ui/graph/elkLayout'
import { NODE_H } from '../../src/ui/graph/dimensions'

const specFor = (id: string): GraphSpec => buildGraphSpec(runSourceSafe(lessonSource(id)!).events)

// Compares by value, independent of Map insertion order — what's being
// checked here is whether COORDINATES change between two runs, not traversal
// order.
const normalize = (boxes: Awaited<ReturnType<typeof layoutGraph>>): string =>
  JSON.stringify([...boxes.entries()].sort(([a], [b]) => a.localeCompare(b)))

describe('layoutGraph — ELK lays out once, deterministically (Task 11)', () => {
  it('every node in the spec has a box', async () => {
    for (const { id } of LESSON_LIST) {
      const spec = specFor(id)
      const boxes = await layoutGraph(spec)
      for (const n of spec.nodes) expect(boxes.has(n.id), `${id}: missing box for ${n.id}`).toBe(true)
    }
  })

  it('box width/height are positive', async () => {
    for (const { id } of LESSON_LIST) {
      const spec = specFor(id)
      const boxes = await layoutGraph(spec)
      for (const n of spec.nodes) {
        const box = boxes.get(n.id)!
        expect(box.width, `${id}: ${n.id}.width`).toBeGreaterThan(0)
        expect(box.height, `${id}: ${n.id}.height`).toBeGreaterThan(0)
      }
    }
  })

  it('deterministic — two runs on the same spec give identical coordinates', async () => {
    for (const { id } of LESSON_LIST) {
      const spec = specFor(id)
      const first = await layoutGraph(spec)
      const second = await layoutGraph(spec)
      expect(normalize(second), id).toBe(normalize(first))
    }
  })

  it("empty spec returns an empty map, doesn't throw", async () => {
    await expect(layoutGraph({ nodes: [], edges: [] })).resolves.toEqual(new Map())
  })

  it('a compound node has height GREATER THAN NODE_H — proving it actually wraps its children', async () => {
    const spec = specFor('supervisor')
    const containerIds = spec.nodes.filter(n => n.isContainer).map(n => n.id)
    // Pin that the fixture really does have a compound node — otherwise this test is meaningless.
    expect(containerIds.length, 'fixture needs a compound node').toBeGreaterThan(0)

    const boxes = await layoutGraph(spec)
    for (const id of containerIds) {
      expect(boxes.get(id)!.height, id).toBeGreaterThan(NODE_H)
    }
  })

  it('child coordinates are RELATIVE to the parent — j3 sits within [0, width(j2)] of supervisor', async () => {
    const spec = specFor('supervisor')
    // Pin the specific shape this test relies on, instead of guessing blind:
    // j2 is a supervisorScope (container), j3 is the first launch sitting
    // directly inside it.
    const j2 = spec.nodes.find(n => n.id === 'j2')
    const j3 = spec.nodes.find(n => n.id === 'j3')
    expect(j2?.isContainer, 'fixture: j2 must be a container').toBe(true)
    expect(j3?.parentId, 'fixture: j3 must be a direct child of j2').toBe('j2')

    const boxes = await layoutGraph(spec)
    const j2Box = boxes.get('j2')!
    const j3Box = boxes.get('j3')!

    // If ELK returned ABSOLUTE canvas coordinates, j3.x would be way beyond
    // width(j2) — this is exactly the check that locks down the assumption
    // that makes React Flow match ELK.
    expect(j3Box.x).toBeGreaterThanOrEqual(0)
    expect(j3Box.y).toBeGreaterThanOrEqual(0)
    expect(j3Box.x + j3Box.width).toBeLessThanOrEqual(j2Box.width)
    expect(j3Box.y + j3Box.height).toBeLessThanOrEqual(j2Box.height)
  })
})
