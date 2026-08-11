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

  it('deterministic: hai lần dựng cho kết quả y hệt', () => {
    for (const id of LESSON_IDS) {
      const events = ev(id)
      expect(JSON.stringify(buildGraphSpec(events)))
        .toBe(JSON.stringify(buildGraphSpec(events)))
    }
  })

  it('trace rỗng cho spec rỗng, không ném', () => {
    expect(buildGraphSpec([])).toEqual({ nodes: [], edges: [] })
  })
})
