import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { buildGraphSpec } from '../../src/engine/trace/graph'
import { foldTrace } from '../../src/engine/trace/world'
import { LESSON_IDS, loadLessonSource } from '../../src/lessons'

const ev = (id: string) => runSource(loadLessonSource(id)).events

describe('buildGraphSpec — shape does NOT depend on step', () => {
  it('the spec built from any prefix is a SUBSET of the full spec, same order', () => {
    // This is exactly the anti-jitter invariant: a node that already exists
    // never disappears or moves in the array as the trace grows longer.
    for (const id of LESSON_IDS) {
      const events = ev(id)
      const full = buildGraphSpec(events).nodes.map(n => n.id)
      for (let n = 0; n <= events.length; n++) {
        const partial = buildGraphSpec(events.slice(0, n)).nodes.map(x => x.id)
        expect(partial, `${id}@${n}`).toEqual(full.slice(0, partial.length))
      }
    }
  })

  it('the node set of the full spec = the job set of foldTrace at the last step', () => {
    for (const id of LESSON_IDS) {
      const events = ev(id)
      const w = foldTrace(events, events.length)
      expect(new Set(buildGraphSpec(events).nodes.map(n => n.id)))
        .toEqual(new Set(w.jobs.keys()))
    }
  })

  it('a PARENT node always precedes its child in the array — React Flow requires this', () => {
    for (const id of LESSON_IDS) {
      const nodes = buildGraphSpec(ev(id)).nodes
      const seen = new Set<string>()
      for (const n of nodes) {
        if (n.parentId !== null) expect(seen.has(n.parentId), `${id}: ${n.id}`).toBe(true)
        seen.add(n.id)
      }
    }
  })

  it('isContainer = has at least one child, not derived from builder', () => {
    const spec = buildGraphSpec(ev('supervisor'))
    for (const n of spec.nodes) {
      expect(n.isContainer).toBe(spec.nodes.some(c => c.parentId === n.id))
    }
  })

  it('structural edges connect the right parent-child pairs', () => {
    const spec = buildGraphSpec(ev('supervisor'))
    const structural = spec.edges.filter(e => e.kind === 'child')
    expect(structural.length).toBe(spec.nodes.filter(n => n.parentId !== null).length)
  })

  it('collects failure edges across the whole trace, keeping the blockedBySupervisor flag', () => {
    const sup = buildGraphSpec(ev('supervisor')).edges.filter(e => e.kind === 'failure')
    expect(sup.length).toBeGreaterThan(0)
    expect(sup.some(e => e.blocked === true)).toBe(true)

    const nor = buildGraphSpec(ev('normalfail')).edges.filter(e => e.kind === 'failure')
    expect(nor.length).toBeGreaterThan(0)
    expect(nor.every(e => e.blocked === false)).toBe(true)
  })

  it('edge ids are unique — React Flow silently drops edges with duplicate ids', () => {
    for (const id of LESSON_IDS) {
      const ids = buildGraphSpec(ev(id)).edges.map(e => e.id)
      expect(new Set(ids).size, id).toBe(ids.length)
    }
  })

  it('deterministic — ids are UNIQUE, independent of run order within the file', () => {
    // The previous two versions were both blind to this. Comparing two
    // consecutive calls: broken state stays broken the same way, so they
    // still match. Interleaving other data in between: still blind when
    // running the WHOLE FILE, because earlier tests have already saturated
    // the Set shared across every lesson.
    // The only order-independent way: use an id no other test touches.
    // If buildGraphSpec kept state across calls, the second call on the SAME
    // data would see every edge as "already seen" and drop all of them ->
    // immediately different from the first call.
    const mk = () => ([
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'det-root', parentId: null,
        builder: 'runBlocking',
        ctx: { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false } },
      { seq: 1, t: 0, k: 'COROUTINE_CREATED', id: 'det-kid', parentId: 'det-root',
        builder: 'launch',
        ctx: { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false } },
      { seq: 2, t: 0, k: 'CANCEL_REQUESTED', from: 'det-root', to: 'det-kid',
        cause: 'CancellationException' },
    ] as unknown as Parameters<typeof buildGraphSpec>[0])

    const first = JSON.stringify(buildGraphSpec(mk()))
    const second = JSON.stringify(buildGraphSpec(mk()))
    expect(second).toBe(first)
    // There has to BE an edge for a lost edge to be detectable.
    expect(JSON.parse(first).edges.length).toBeGreaterThan(0)
  })

  it('GraphSpec does NOT depend on step — the basis of all anti-jitter behavior', () => {
    // The real invariant is NOT "don't touch foldTrace" (folding to the LAST
    // step means every job already exists, so it's equivalent to scanning
    // the whole trace). The invariant is: shape is derived from the WHOLE
    // trace, not from the state at the currently-viewed step. If someone
    // switches to foldTrace(events, n) with n as the currently-viewed step,
    // the node count would drop along with n and ELK would produce a
    // different layout every tick.
    for (const id of LESSON_IDS) {
      const events = ev(id)
      const full = buildGraphSpec(events)

      // The cutoff point must be DERIVED FROM THE DATA, not a guessed
      // fraction. Measured: every coroutine is created very early
      // (COROUTINE_CREATED last at seq 8-12 out of 48-64 total), so "the
      // first third" would already contain 100% of the nodes and the
      // comparison would always be equal — a meaningless test. Cutting right
      // BEFORE the last creation guarantees exactly one missing node.
      const creationIdx = events
        .map((e, i) => (e.k === 'COROUTINE_CREATED' ? i : -1))
        .filter(i => i >= 0)
      expect(creationIdx.length, `${id}: fixture needs >= 2 coroutines`).toBeGreaterThan(1)
      const early = buildGraphSpec(events.slice(0, creationIdx[creationIdx.length - 1]!))

      // The prefix must give FEWER nodes — if they're equal, this test is meaningless.
      expect(early.nodes.length, id).toBeLessThan(full.nodes.length)

      // The full spec CONTAINS the entire early spec, and preserves the
      // RELATIVE ORDER of the shared part. A changed order means ELK
      // produces a different layout, i.e. jitter.
      const fullIds = full.nodes.map(n => n.id)
      const earlyIds = early.nodes.map(n => n.id)
      for (const nid of earlyIds) expect(fullIds, id).toContain(nid)
      expect(fullIds.filter(x => earlyIds.includes(x)), id).toEqual(earlyIds)
    }
  })

  it('edges produced by a LATE event are still present — this is what actually catches a truncated trace', () => {
    // Nodes are created very early (COROUTINE_CREATED last at seq <= 12), so
    // truncating the trace does NOT lose any node and every assertion based
    // on .nodes is blind to it. Cancel/failure edges are produced at the
    // END — only checking .edges catches this.
    const events = ev('jobtree')
    const cancelIdx = events
      .map((e, i) => (e.k === 'CANCEL_REQUESTED' ? i : -1))
      .filter(i => i >= 0)
    expect(cancelIdx.length, 'fixture needs a CANCEL_REQUESTED').toBeGreaterThan(0)
    // Pin down that they REALLY sit in the second half — otherwise this test is blind too.
    expect(cancelIdx[cancelIdx.length - 1]!).toBeGreaterThan(events.length / 2)

    const spec = buildGraphSpec(events)
    expect(spec.edges.filter(e => e.kind === 'cancel').length).toBeGreaterThan(0)
  })

  it('duplicate edges get merged — events built by hand since no real lesson produces this case', () => {
    // edgeSeen has never been exercised: no fixture emits a duplicate edge.
    // Build two events by hand that both imply the same edge.
    const evs = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking',
        ctx: { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false } },
      { seq: 1, t: 0, k: 'COROUTINE_CREATED', id: 'c', parentId: 'p', builder: 'launch',
        ctx: { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false } },
      { seq: 2, t: 0, k: 'CANCEL_REQUESTED', from: 'p', to: 'c', cause: 'CancellationException' },
      { seq: 3, t: 0, k: 'CANCEL_REQUESTED', from: 'p', to: 'c', cause: 'CancellationException' },
    ] as unknown as Parameters<typeof buildGraphSpec>[0]

    const spec = buildGraphSpec(evs)
    const cancelEdges = spec.edges.filter(e => e.source === 'p' && e.target === 'c' && e.kind === 'cancel')
    expect(cancelEdges).toHaveLength(1)
  })

  it('an empty trace gives an empty spec, no throw', () => {
    expect(buildGraphSpec([])).toEqual({ nodes: [], edges: [] })
  })
})
