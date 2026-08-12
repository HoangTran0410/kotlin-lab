import { describe, expect, it } from 'vitest'
import type { CtxSummary, Event } from '../../src/engine/trace/events'
import { runSource } from '../../src/engine/run'
import { buildGraphSpec } from '../../src/engine/trace/graph'
import { foldTrace } from '../../src/engine/trace/world'
import { LESSON_IDS, loadLessonSource } from '../../src/lessons'
import { layoutGraph } from '../../src/ui/graph/elkLayout'
import { toReactFlow } from '../../src/ui/graph/toReactFlow'

const eventsOf = (id: string): Event[] => runSource(loadLessonSource(id)).events

const CTX: CtxSummary = { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false }

describe('toReactFlow — where anti-jitter gets locked down (Task 12)', () => {
  it('NODE POSITION IS INVARIANT across every step — the anti-jitter invariant', async () => {
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      const at = (n: number): string => JSON.stringify(
        toReactFlow(spec, layout, foldTrace(events, n)).nodes.map(x => [x.id, x.position]))
      const ref = at(events.length)
      for (let n = 0; n <= events.length; n++) expect(at(n), `${id}@${n}`).toBe(ref)
    }
  })

  it('the set of node ids is invariant across every step, including step 0', async () => {
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      const fullIds = new Set(spec.nodes.map(n => n.id))
      expect(fullIds.size, `${id}: fixture needs >= 1 node`).toBeGreaterThan(0)

      for (let n = 0; n <= events.length; n++) {
        const ids = new Set(toReactFlow(spec, layout, foldTrace(events, n)).nodes.map(x => x.id))
        expect(ids, `${id}@${n}`).toEqual(fullIds)
      }
    }
  })

  it('array order is invariant — parent always comes before child, locked down SEPARATELY at the React Flow layer', async () => {
    // Task 4 already locked down this invariant on buildGraphSpec(...).nodes.
    // layoutGraph (Task 11) is completely insensitive to order because it
    // builds the tree by looking up parentId. toReactFlow is the ONLY layer
    // where React Flow actually reads this array to infer relative
    // coordinates — so it must be locked down HERE too, on toReactFlow's own
    // output, so a mistake in toReactFlow.ts or elkLayout.ts (e.g.
    // accidentally sorting/re-traversing the array) gets caught, instead of
    // just trusting the Task 4 test.
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      // Pin the fixture: needs at least one node with a parent, otherwise the test is meaningless.
      expect(spec.nodes.some(n => n.parentId !== null), id).toBe(true)

      for (const n of [0, Math.floor(events.length / 2), events.length]) {
        const nodes = toReactFlow(spec, layout, foldTrace(events, n)).nodes
        const seen = new Set<string>()
        for (const nd of nodes) {
          if (nd.parentId !== undefined) expect(seen.has(nd.parentId), `${id}@${n}: ${nd.id}`).toBe(true)
          seen.add(nd.id)
        }
      }
    }
  })

  it('a node not born yet has data.phase === "unborn"; a born node doesn\'t', async () => {
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)

      const atStart = toReactFlow(spec, layout, foldTrace(events, 0)).nodes
      expect(atStart.length, id).toBeGreaterThan(0)
      for (const n of atStart) expect(n.data.phase, `${id}: ${n.id}@0`).toBe('unborn')

      const atEnd = toReactFlow(spec, layout, foldTrace(events, events.length)).nodes
      for (const n of atEnd) expect(n.data.phase, `${id}: ${n.id}@end`).not.toBe('unborn')
    }
  })

  it('a born node carries the correct state from world.jobs at EVERY step, never inferred from the parent', async () => {
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      for (let n = 0; n <= events.length; n++) {
        const world = foldTrace(events, n)
        const nodes = toReactFlow(spec, layout, world).nodes
        for (const nd of nodes) {
          const job = world.jobs.get(nd.id)
          expect(nd.data.state, `${id}@${n}: ${nd.id}`).toBe(job?.state ?? null)
        }
      }
    }
  })

  it('parent Completed while a child is still Active leaves the child STILL Active — locks down backlog item A1', async () => {
    // The real FSM (job.ts) never produces this scenario in the three lessons
    // (measured: no step in jobtree/normalfail/supervisor has a parent
    // Completed while a child is still New/Active/Completing/Cancelling) —
    // built by hand following the brief's exact instructions, simulating
    // backlog item A1 (join/joinChildren trusts isCompleted without checking
    // task.finished, so a parent can emit Completed BEFORE the child's
    // finally finishes running).
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 0, k: 'COROUTINE_CREATED', id: 'c', parentId: 'p', builder: 'launch', ctx: CTX },
      { seq: 2, t: 1, k: 'JOB_STATE', id: 'p', from: 'New', to: 'Active' },
      { seq: 3, t: 1, k: 'JOB_STATE', id: 'c', from: 'New', to: 'Active' },
      { seq: 4, t: 2, k: 'JOB_STATE', id: 'p', from: 'Active', to: 'Completed' },
    ]
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)

    // Pin the exact A1 scenario: parent already Completed, child still Active.
    expect(world.jobs.get('p')?.state).toBe('Completed')
    expect(world.jobs.get('c')?.state).toBe('Active')

    const child = toReactFlow(spec, layout, world).nodes.find(n => n.id === 'c')
    expect(child?.data.state).toBe('Active')
  })

  it('parentId + extent "parent" are set CORRECTLY on nodes with a parent, no more no less', async () => {
    const events = eventsOf('supervisor')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const nodes = toReactFlow(spec, layout, foldTrace(events, events.length)).nodes
    const byId = new Map(spec.nodes.map(n => [n.id, n]))

    expect(nodes.some(n => n.parentId !== undefined), 'fixture needs a node with a parent').toBe(true)
    expect(nodes.some(n => n.parentId === undefined), 'fixture needs a node WITHOUT a parent').toBe(true)

    for (const nd of nodes) {
      const src = byId.get(nd.id)!
      if (src.parentId === null) {
        expect(nd.parentId, nd.id).toBeUndefined()
        expect(nd.extent, nd.id).toBeUndefined()
      } else {
        expect(nd.parentId, nd.id).toBe(src.parentId)
        expect(nd.extent, nd.id).toBe('parent')
      }
    }
  })

  it('a compound node uses type "scope", a leaf node uses type "job"', async () => {
    const events = eventsOf('supervisor')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const nodes = toReactFlow(spec, layout, foldTrace(events, events.length)).nodes
    const byId = new Map(spec.nodes.map(n => [n.id, n]))

    expect(spec.nodes.some(n => n.isContainer), 'fixture needs a compound node').toBe(true)
    expect(spec.nodes.some(n => !n.isContainer), 'fixture needs a leaf node').toBe(true)

    for (const nd of nodes) {
      expect(nd.type, nd.id).toBe(byId.get(nd.id)!.isContainer ? 'scope' : 'job')
    }
  })

  it("a failure edge carries the correct data.blocked — supervisor has blocked:true, normalfail doesn't", async () => {
    const failureEdgesOf = async (id: string) => {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      return toReactFlow(spec, layout, foldTrace(events, events.length)).edges
        .filter(e => e.data?.kind === 'failure')
    }

    const sup = await failureEdgesOf('supervisor')
    expect(sup.length, 'supervisor').toBeGreaterThan(0)
    expect(sup.some(e => e.data?.blocked === true), 'supervisor').toBe(true)

    const nor = await failureEdgesOf('normalfail')
    expect(nor.length, 'normalfail').toBeGreaterThan(0)
    expect(nor.every(e => e.data?.blocked === false), 'normalfail').toBe(true)
  })

  it('a failure edge pointing at an ALREADY-Cancelled node is still emitted — locks down backlog item A4', async () => {
    const events = eventsOf('normalfail')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)

    const toCancelled = spec.edges
      .filter(e => e.kind === 'failure')
      .filter(e => world.jobs.get(e.target)?.state === 'Cancelled')
    // Pin the fixture: normalfail REALLY does have a failure edge pointing at an already-Cancelled node.
    expect(toCancelled.length, 'fixture needs a failure edge -> Cancelled node').toBeGreaterThan(0)

    const outIds = new Set(toReactFlow(spec, layout, world).edges.map(e => e.id))
    for (const e of toCancelled) expect(outIds.has(e.id), e.id).toBe(true)
  })

  it('cause only shows when state is Cancelling/Cancelled — locks down backlog item B4', async () => {
    // Real case: normalfail, j2 ends up Cancelled with a real cause — must show.
    const events = eventsOf('normalfail')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)
    expect(world.jobs.get('j2')?.state, 'fixture').toBe('Cancelled')
    expect(world.jobs.get('j2')?.cause, 'fixture').toBeTruthy()

    const j2 = toReactFlow(spec, layout, world).nodes.find(n => n.id === 'j2')
    expect(j2?.data.cause).toBe(world.jobs.get('j2')!.cause)

    // Backlog item B4 scenario: cause SURVIVES on WorldState.jobs across a
    // transition that carries no cause (world.ts only overwrites `j.cause`
    // when `e.cause` is truthy). Built by hand because the real FSM (job.ts,
    // the ALLOWED table) doesn't let Cancelling go anywhere except Cancelled,
    // so the three real lessons never produce this case — but foldTrace
    // doesn't validate the FSM, it mechanically applies field by field to
    // ANY Event[], so it's still a valid state toReactFlow needs to defend
    // itself against.
    const staleEvents: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'x', parentId: null, builder: 'launch', ctx: CTX },
      { seq: 1, t: 0, k: 'JOB_STATE', id: 'x', from: 'New', to: 'Active' },
      { seq: 2, t: 1, k: 'JOB_STATE', id: 'x', from: 'Active', to: 'Cancelling', cause: 'Boom' },
      { seq: 3, t: 2, k: 'JOB_STATE', id: 'x', from: 'Cancelling', to: 'Completed' },
    ]
    const staleSpec = buildGraphSpec(staleEvents)
    const staleLayout = await layoutGraph(staleSpec)
    const staleWorld = foldTrace(staleEvents, staleEvents.length)
    // Pin: the raw WorldState REALLY does keep the stale cause — this is world.ts's existing behavior.
    expect(staleWorld.jobs.get('x')?.state).toBe('Completed')
    expect(staleWorld.jobs.get('x')?.cause).toBe('Boom')

    const x = toReactFlow(staleSpec, staleLayout, staleWorld).nodes.find(n => n.id === 'x')
    expect(x?.data.cause).toBeNull()
  })

  it('an ancestor the failure climbed through shows the causing message, even without a failure of its own', async () => {
    // normalfail: j2 (the coroutineScope) is dragged down because its child
    // j4 (launch B, `throw RuntimeException("boom")`) failed. j2 never threw
    // anything itself — `failure` stays null — but j2's Cancelling event DID
    // come from terminateAsFailed (reportFailure's climb-up loop), which
    // means j2 genuinely inherits this as its own recorded failure (for a
    // coroutineScope this is literally rethrown at its call site), so the
    // message belongs on its node.
    const events = eventsOf('normalfail')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)
    expect(world.jobs.get('j2'), 'fixture').toMatchObject({ state: 'Cancelled', builder: 'coroutineScope', failure: null })

    const j2 = toReactFlow(spec, layout, world).nodes.find(n => n.id === 'j2')
    expect(j2?.data.causeMessage).toBe('boom')
  })

  it('an innocent sibling dragged down alongside the failure does NOT get the causing message', async () => {
    // j3 (launch A) is a SIBLING of j4 (the thrower) — cancelled via
    // cancelJob, not terminateAsFailed. It never actually receives the
    // original exception when unwound, only a synthetic
    // CancellationException (locked down in
    // interpreter-coroutines.test.ts's "still gets a CancellationException,
    // not a sibling's exception"). The graph must not claim otherwise.
    const events = eventsOf('normalfail')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)
    expect(world.jobs.get('j3'), 'fixture').toMatchObject({ state: 'Cancelled', builder: 'launch', failure: null })

    const j3 = toReactFlow(spec, layout, world).nodes.find(n => n.id === 'j3')
    expect(j3?.data.causeMessage).toBeNull()
  })

  it('a node missing its layout box gets skipped, not thrown', async () => {
    const events = eventsOf('jobtree')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)

    expect(spec.nodes.length, 'fixture needs >= 2 nodes').toBeGreaterThan(1)
    const missingId = spec.nodes[spec.nodes.length - 1]!.id
    const damaged = new Map(layout)
    damaged.delete(missingId)

    let result: ReturnType<typeof toReactFlow> | undefined
    expect(() => { result = toReactFlow(spec, damaged, world) }).not.toThrow()
    expect(result!.nodes.some(n => n.id === missingId)).toBe(false)
    expect(result!.nodes.length).toBe(spec.nodes.length - 1)
    // An edge pointing to a dropped node (if any) must also not be orphaned in the output.
    for (const e of result!.edges) {
      expect(e.source).not.toBe(missingId)
      expect(e.target).not.toBe(missingId)
    }
  })
})
