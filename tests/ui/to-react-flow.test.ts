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

describe('toReactFlow — nơi chống rung được khoá chặt (Task 12)', () => {
  it('VỊ TRÍ NODE BẤT BIẾN qua mọi step — bất biến chống rung', async () => {
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

  it('tập id node bất biến qua mọi step, kể cả step 0', async () => {
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      const fullIds = new Set(spec.nodes.map(n => n.id))
      expect(fullIds.size, `${id}: fixture cần >= 1 node`).toBeGreaterThan(0)

      for (let n = 0; n <= events.length; n++) {
        const ids = new Set(toReactFlow(spec, layout, foldTrace(events, n)).nodes.map(x => x.id))
        expect(ids, `${id}@${n}`).toEqual(fullIds)
      }
    }
  })

  it('thứ tự mảng bất biến — cha luôn đứng trước con, khoá RIÊNG ở tầng React Flow', async () => {
    // Task 4 đã khoá bất biến này trên buildGraphSpec(...).nodes. layoutGraph
    // (Task 11) hoàn toàn không nhạy với thứ tự vì nó dựng cây bằng tra
    // parentId. toReactFlow là tầng DUY NHẤT mà React Flow thật sự đọc mảng
    // này để suy toạ độ tương đối — nên phải khoá lại ở ĐÂY, trên chính output
    // của toReactFlow, để một sai sót trong toReactFlow.ts hay elkLayout.ts
    // (ví dụ lỡ sort/duyệt lại mảng) bị bắt, thay vì chỉ tin vào test Task 4.
    for (const id of LESSON_IDS) {
      const events = eventsOf(id)
      const spec = buildGraphSpec(events)
      const layout = await layoutGraph(spec)
      // Ghim fixture: cần có ít nhất một node có cha, nếu không test rỗng nghĩa.
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

  it('node chưa sinh ra có data.phase === "unborn"; node đã sinh thì không', async () => {
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

  it('node đã sinh mang đúng state từ world.jobs cho MỌI step, không suy từ cha', async () => {
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

  it('cha Completed trong khi con vẫn Active thì con VẪN Active — khoá tồn đọng A1', async () => {
    // FSM thật (job.ts) không phát ra cảnh này trong ba lesson (đã đo: không
    // bước nào trong jobtree/normalfail/supervisor có cha Completed trong khi
    // một con còn New/Active/Completing/Cancelling) — dựng tay theo đúng chỉ
    // dẫn của brief, mô phỏng tồn đọng A1 (join/joinChildren tin isCompleted
    // mà không hỏi task.finished, nên cha có thể phát Completed TRƯỚC khi
    // finally của con chạy xong).
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

    // Ghim đúng ca A1: cha đã Completed, con vẫn Active.
    expect(world.jobs.get('p')?.state).toBe('Completed')
    expect(world.jobs.get('c')?.state).toBe('Active')

    const child = toReactFlow(spec, layout, world).nodes.find(n => n.id === 'c')
    expect(child?.data.state).toBe('Active')
  })

  it('parentId + extent "parent" đặt ĐÚNG trên những node có cha, không hơn không kém', async () => {
    const events = eventsOf('supervisor')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const nodes = toReactFlow(spec, layout, foldTrace(events, events.length)).nodes
    const byId = new Map(spec.nodes.map(n => [n.id, n]))

    expect(nodes.some(n => n.parentId !== undefined), 'fixture cần có node có cha').toBe(true)
    expect(nodes.some(n => n.parentId === undefined), 'fixture cần có node KHÔNG cha').toBe(true)

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

  it('node compound dùng type "scope", node lá dùng type "job"', async () => {
    const events = eventsOf('supervisor')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const nodes = toReactFlow(spec, layout, foldTrace(events, events.length)).nodes
    const byId = new Map(spec.nodes.map(n => [n.id, n]))

    expect(spec.nodes.some(n => n.isContainer), 'fixture cần có node compound').toBe(true)
    expect(spec.nodes.some(n => !n.isContainer), 'fixture cần có node lá').toBe(true)

    for (const nd of nodes) {
      expect(nd.type, nd.id).toBe(byId.get(nd.id)!.isContainer ? 'scope' : 'job')
    }
  })

  it('cạnh failure mang data.blocked đúng — supervisor có blocked:true, normalfail thì không', async () => {
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

  it('cạnh failure trỏ vào node ĐÃ Cancelled vẫn được phát — khoá tồn đọng A4', async () => {
    const events = eventsOf('normalfail')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)

    const toCancelled = spec.edges
      .filter(e => e.kind === 'failure')
      .filter(e => world.jobs.get(e.target)?.state === 'Cancelled')
    // Ghim fixture: normalfail THẬT SỰ có cạnh failure trỏ vào node đã Cancelled.
    expect(toCancelled.length, 'fixture cần cạnh failure -> node Cancelled').toBeGreaterThan(0)

    const outIds = new Set(toReactFlow(spec, layout, world).edges.map(e => e.id))
    for (const e of toCancelled) expect(outIds.has(e.id), e.id).toBe(true)
  })

  it('cause chỉ hiện khi state là Cancelling/Cancelled — khoá tồn đọng B4', async () => {
    // Ca thật: normalfail, j2 kết thúc Cancelled với cause thật — phải hiện.
    const events = eventsOf('normalfail')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)
    expect(world.jobs.get('j2')?.state, 'fixture').toBe('Cancelled')
    expect(world.jobs.get('j2')?.cause, 'fixture').toBeTruthy()

    const j2 = toReactFlow(spec, layout, world).nodes.find(n => n.id === 'j2')
    expect(j2?.data.cause).toBe(world.jobs.get('j2')!.cause)

    // Ca tồn đọng B4: cause SỐNG SÓT trên WorldState.jobs qua một transition
    // không mang cause (world.ts chỉ ghi đè `j.cause` khi `e.cause` truthy).
    // Dựng tay vì FSM thật (job.ts, bảng ALLOWED) không cho Cancelling đi tới
    // đâu khác ngoài Cancelled, nên ba lesson thật không bao giờ tạo ra ca
    // này — nhưng foldTrace không thẩm định FSM, nó áp máy móc field theo
    // field trên BẤT KỲ Event[] nào, nên vẫn là một trạng thái hợp lệ cần
    // toReactFlow tự phòng thủ.
    const staleEvents: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'x', parentId: null, builder: 'launch', ctx: CTX },
      { seq: 1, t: 0, k: 'JOB_STATE', id: 'x', from: 'New', to: 'Active' },
      { seq: 2, t: 1, k: 'JOB_STATE', id: 'x', from: 'Active', to: 'Cancelling', cause: 'Boom' },
      { seq: 3, t: 2, k: 'JOB_STATE', id: 'x', from: 'Cancelling', to: 'Completed' },
    ]
    const staleSpec = buildGraphSpec(staleEvents)
    const staleLayout = await layoutGraph(staleSpec)
    const staleWorld = foldTrace(staleEvents, staleEvents.length)
    // Ghim: WorldState thô THẬT SỰ giữ cause cũ — đây là hành vi world.ts sẵn có.
    expect(staleWorld.jobs.get('x')?.state).toBe('Completed')
    expect(staleWorld.jobs.get('x')?.cause).toBe('Boom')

    const x = toReactFlow(staleSpec, staleLayout, staleWorld).nodes.find(n => n.id === 'x')
    expect(x?.data.cause).toBeNull()
  })

  it('layout thiếu box cho một node thì node đó bị bỏ qua, không ném', async () => {
    const events = eventsOf('jobtree')
    const spec = buildGraphSpec(events)
    const layout = await layoutGraph(spec)
    const world = foldTrace(events, events.length)

    expect(spec.nodes.length, 'fixture cần >= 2 node').toBeGreaterThan(1)
    const missingId = spec.nodes[spec.nodes.length - 1]!.id
    const damaged = new Map(layout)
    damaged.delete(missingId)

    let result: ReturnType<typeof toReactFlow> | undefined
    expect(() => { result = toReactFlow(spec, damaged, world) }).not.toThrow()
    expect(result!.nodes.some(n => n.id === missingId)).toBe(false)
    expect(result!.nodes.length).toBe(spec.nodes.length - 1)
    // Cạnh trỏ tới node bị bỏ (nếu có) cũng không được mồ côi trong output.
    for (const e of result!.edges) {
      expect(e.source).not.toBe(missingId)
      expect(e.target).not.toBe(missingId)
    }
  })
})
