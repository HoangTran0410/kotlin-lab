import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'
import { buildGraphSpec } from '../../src/engine/trace/graph'
import { foldTrace } from '../../src/engine/trace/world'
import type { Event } from '../../src/engine/trace/events'
import * as elkLayoutModule from '../../src/ui/graph/elkLayout'
import { toReactFlow } from '../../src/ui/graph/toReactFlow'
import { lessonSource } from '../../src/lessons/registry'

const LESSON_IDS = ['jobtree', 'normalfail', 'supervisor'] as const

/**
 * `elkLayoutModule.layoutGraph(...)` — KHÔNG named-import `layoutGraph` thẳng
 * — để bài test "gọi đúng một lần" bên dưới spy đúng điểm mà `prep` thật sự
 * gọi tới, không phụ thuộc cách bundler/vitest có coi named import và truy
 * cập qua namespace là cùng một binding hay không (xem cách
 * tests/ui/use-layout.test.tsx đã làm với hook thật).
 */
const prep = async (id: string) => {
  const { events, diagnostics } = runSourceSafe(lessonSource(id)!)
  expect(diagnostics, id).toEqual([])
  const spec = buildGraphSpec(events)
  return { events, spec, layout: await elkLayoutModule.layoutGraph(spec) }
}
const final = (events: readonly Event[]) => foldTrace(events, events.length)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NGHIỆM THU M2 — khác biệt supervisor phải NHÌN THẤY ĐƯỢC', () => {
  it('console: normalfail 0 dòng, supervisor 2 dòng', async () => {
    expect(final((await prep('normalfail')).events).output).toEqual([])
    expect(final((await prep('supervisor')).events).output).toEqual(['A xong', 'C xong'])
  })

  it('graph: anh em CHẾT ở normalfail, SỐNG ở supervisor', async () => {
    const dead = await prep('normalfail')
    const alive = await prep('supervisor')
    const states = (p: Awaited<ReturnType<typeof prep>>) =>
      toReactFlow(p.spec, p.layout, final(p.events)).nodes
        .filter(n => n.data.builder === 'launch')
        .map(n => n.data.state)
        .sort()

    expect(states(dead).every(s => s === 'Cancelled')).toBe(true)
    // supervisor: hai launch Completed (A, C) + một Cancelled (B ném)
    expect(states(alive).filter(s => s === 'Completed')).toHaveLength(2)
    expect(states(alive).filter(s => s === 'Cancelled')).toHaveLength(1)
  })

  it('cạnh: chỉ supervisor có cạnh failure BỊ CHẶN', async () => {
    const blocked = (p: Awaited<ReturnType<typeof prep>>) =>
      toReactFlow(p.spec, p.layout, final(p.events)).edges
        .filter(e => e.data?.kind === 'failure' && e.data?.blocked === true)

    expect(blocked(await prep('normalfail'))).toHaveLength(0)
    expect(blocked(await prep('supervisor')).length).toBeGreaterThan(0)
  })

  it('VỊ TRÍ NODE bất biến qua tiến-rồi-lùi hết trace, cả ba lesson', async () => {
    for (const id of LESSON_IDS) {
      const p = await prep(id)
      const at = (n: number) => JSON.stringify(
        toReactFlow(p.spec, p.layout, foldTrace(p.events, n)).nodes.map(x => [x.id, x.position]))
      const ref = at(p.events.length)
      for (let n = 0; n <= p.events.length; n++) expect(at(n), `${id} tiến @${n}`).toBe(ref)
      for (let n = p.events.length; n >= 0; n--) expect(at(n), `${id} lùi @${n}`).toBe(ref)
    }
  })

  it('mọi step gập được, không ném — cả ba lesson', async () => {
    for (const id of LESSON_IDS) {
      const p = await prep(id)
      for (let n = 0; n <= p.events.length; n++) {
        expect(() => toReactFlow(p.spec, p.layout, foldTrace(p.events, n))).not.toThrow()
      }
    }
  })

  it('layoutGraph được gọi ĐÚNG MỘT LẦN cho mỗi lesson, dù bố cục toàn bộ trace', async () => {
    // Bổ sung so với khung sườn của brief: bảng nghiệm thu đòi "layoutGraph gọi
    // đúng một lần cho mỗi lesson" như một hàng riêng, ngang hàng với vị trí
    // node bất biến — nhưng khối test mẫu trong task-20-brief.md chỉ IMPORT
    // `vi` mà không dùng nó ở đâu cả. tests/ui/use-layout.test.tsx đã khoá
    // hành vi này ở tầng hook (Task 15) bằng spec giả lập; test này khoá lại
    // trên chính ba lesson thật, ở đúng nơi acceptance đọc tiêu chí.
    const spy = vi.spyOn(elkLayoutModule, 'layoutGraph')
    for (const id of LESSON_IDS) {
      spy.mockClear()
      await prep(id)
      expect(spy, id).toHaveBeenCalledTimes(1)
    }
  })
})
