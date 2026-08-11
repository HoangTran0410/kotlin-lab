import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { buildGraphSpec } from '../../src/engine/trace/graph'
import { foldTrace } from '../../src/engine/trace/world'
import { LESSON_IDS, loadLessonSource } from '../../src/lessons'

const ev = (id: string) => runSource(loadLessonSource(id)).events

describe('buildGraphSpec — hình dạng KHÔNG phụ thuộc step', () => {
  it('spec dựng từ tiền tố bất kỳ là TẬP CON của spec đầy đủ, cùng thứ tự', () => {
    // Đây chính là bất biến chống rung: node đã có không bao giờ biến mất
    // hay đổi chỗ trong mảng khi trace dài thêm.
    for (const id of LESSON_IDS) {
      const events = ev(id)
      const full = buildGraphSpec(events).nodes.map(n => n.id)
      for (let n = 0; n <= events.length; n++) {
        const partial = buildGraphSpec(events.slice(0, n)).nodes.map(x => x.id)
        expect(partial, `${id}@${n}`).toEqual(full.slice(0, partial.length))
      }
    }
  })

  it('tập node của spec đầy đủ = tập job của foldTrace ở step cuối', () => {
    for (const id of LESSON_IDS) {
      const events = ev(id)
      const w = foldTrace(events, events.length)
      expect(new Set(buildGraphSpec(events).nodes.map(n => n.id)))
        .toEqual(new Set(w.jobs.keys()))
    }
  })

  it('node CHA luôn đứng trước con trong mảng — React Flow bắt buộc', () => {
    for (const id of LESSON_IDS) {
      const nodes = buildGraphSpec(ev(id)).nodes
      const seen = new Set<string>()
      for (const n of nodes) {
        if (n.parentId !== null) expect(seen.has(n.parentId), `${id}: ${n.id}`).toBe(true)
        seen.add(n.id)
      }
    }
  })

  it('isContainer = có ít nhất một con, không theo builder', () => {
    const spec = buildGraphSpec(ev('supervisor'))
    for (const n of spec.nodes) {
      expect(n.isContainer).toBe(spec.nodes.some(c => c.parentId === n.id))
    }
  })

  it('cạnh cấu trúc nối đúng cha-con', () => {
    const spec = buildGraphSpec(ev('supervisor'))
    const structural = spec.edges.filter(e => e.kind === 'child')
    expect(structural.length).toBe(spec.nodes.filter(n => n.parentId !== null).length)
  })

  it('gom cạnh failure của cả trace, giữ cờ blockedBySupervisor', () => {
    const sup = buildGraphSpec(ev('supervisor')).edges.filter(e => e.kind === 'failure')
    expect(sup.length).toBeGreaterThan(0)
    expect(sup.some(e => e.blocked === true)).toBe(true)

    const nor = buildGraphSpec(ev('normalfail')).edges.filter(e => e.kind === 'failure')
    expect(nor.length).toBeGreaterThan(0)
    expect(nor.every(e => e.blocked === false)).toBe(true)
  })

  it('id cạnh là duy nhất — React Flow bỏ cạnh trùng id trong im lặng', () => {
    for (const id of LESSON_IDS) {
      const ids = buildGraphSpec(ev(id)).edges.map(e => e.id)
      expect(new Set(ids).size, id).toBe(ids.length)
    }
  })

  it('deterministic — xen kẽ dữ liệu KHÁC giữa hai lần gọi', () => {
    // So hai lần gọi liên tiếp với nhau KHÔNG bắt được state rò rỉ ở module
    // scope: cả hai cùng thấy state hỏng như nhau nên vẫn bằng nhau. Đã kiểm
    // chứng: hoisting Set dedup ra ngoài hàm làm 2 test KHÁC đỏ, còn test
    // "deterministic" kiểu cũ vẫn xanh. Xen một trace KHÁC vào giữa thì mọi
    // state sống sót qua lời gọi sẽ lộ ra.
    const a = ev('jobtree')
    const b = ev('supervisor')
    const a1 = JSON.stringify(buildGraphSpec(a))
    buildGraphSpec(b)
    const a2 = JSON.stringify(buildGraphSpec(a))
    expect(a2).toBe(a1)
  })

  it('GraphSpec KHÔNG phụ thuộc step — cơ sở của toàn bộ chống rung', () => {
    // Bất biến thật KHÔNG phải "đừng đụng foldTrace" (fold tới step CUỐI thì
    // mọi job đã tồn tại nên tương đương quét toàn trace). Bất biến là: hình
    // dạng lấy từ TOÀN trace, không phải từ trạng thái ở step hiện tại.
    // Nếu ai đó đổi sang foldTrace(events, n) với n là step đang xem, số node
    // sẽ tụt theo n và ELK sẽ cho layout khác mỗi tick.
    for (const id of LESSON_IDS) {
      const events = ev(id)
      const full = buildGraphSpec(events)

      // Mốc cắt phải SUY RA TỪ DỮ LIỆU, không phải một phân số đoán bừa.
      // Đã đo: mọi coroutine được tạo rất sớm (COROUTINE_CREATED cuối ở seq
      // 8-12 trên tổng 48-64), nên "một phần ba đầu" đã chứa 100% node và
      // phép so sẽ luôn bằng nhau — test vô nghĩa. Cắt ngay TRƯỚC lần tạo
      // cuối cùng thì chắc chắn thiếu đúng một node.
      const creationIdx = events
        .map((e, i) => (e.k === 'COROUTINE_CREATED' ? i : -1))
        .filter(i => i >= 0)
      expect(creationIdx.length, `${id}: fixture cần >= 2 coroutine`).toBeGreaterThan(1)
      const early = buildGraphSpec(events.slice(0, creationIdx[creationIdx.length - 1]!))

      // Tiền tố cho ÍT node hơn — nếu bằng nhau thì test này vô nghĩa.
      expect(early.nodes.length, id).toBeLessThan(full.nodes.length)

      // Spec đầy đủ CHỨA trọn spec sớm, và giữ nguyên THỨ TỰ tương đối của
      // phần chung. Thứ tự đổi là ELK ra layout khác, tức là rung.
      const fullIds = full.nodes.map(n => n.id)
      const earlyIds = early.nodes.map(n => n.id)
      for (const nid of earlyIds) expect(fullIds, id).toContain(nid)
      expect(fullIds.filter(x => earlyIds.includes(x)), id).toEqual(earlyIds)
    }
  })

  it('cạnh trùng bị gộp — dựng event thủ công vì lesson thật không sinh ra ca này', () => {
    // edgeSeen chưa từng được kiểm: không fixture nào phát cạnh trùng.
    // Dựng tay hai event cùng ngụ ý một cạnh.
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

  it('trace rỗng cho spec rỗng, không ném', () => {
    expect(buildGraphSpec([])).toEqual({ nodes: [], edges: [] })
  })
})
