import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Compiled } from '../../src/state/compile'
import type { GraphSpec } from '../../src/engine/trace/graph'
import type { LayoutResult } from '../../src/ui/graph/elkLayout'
import * as elkLayoutModule from '../../src/ui/graph/elkLayout'
import { useLayout } from '../../src/ui/graph/useLayout'

/**
 * `layoutGraph` được spy trên MODULE, không mock hẳn ELK — hook import nó
 * bằng named import từ chính module này, nên ghi đè `elkLayoutModule.layoutGraph`
 * (Vitest transform ESM thành binding có thể spy) là điểm chặn đúng chỗ mà
 * effect trong useLayout.ts thật sự gọi tới.
 */
function spyLayoutGraph() {
  return vi.spyOn(elkLayoutModule, 'layoutGraph')
}

const EMPTY_SPEC: GraphSpec = { nodes: [], edges: [] }

const specWithNodes = (n: number): GraphSpec => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `n${i}`, parentId: null, builder: 'launch', isContainer: false,
    isSupervisor: false, name: null, varName: null, dispatcher: 'Default', bornAt: i,
  })),
  edges: [],
})

let nextRevision = 1
/** Mỗi lần gọi mô phỏng đúng một lần `compile()` — revision khác nhau mỗi lần. */
function compiledFixture(spec: GraphSpec = specWithNodes(1)): Compiled {
  return { events: [], diagnostics: [], spec, revision: nextRevision++ }
}

function box(x: number): LayoutResult {
  return new Map([['n0', { x, y: 0, width: 1, height: 1 }]])
}

/** Promise điều khiển được từ ngoài — dựng cảnh "hai kết quả về ngược thứ tự". */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLayout (Task 15) — ELK chạy một lần mỗi compile, chống kết quả cũ', () => {
  it('kéo qua 20 "step" (props không đổi) chỉ gọi layoutGraph đúng 1 lần', async () => {
    const spy = spyLayoutGraph().mockResolvedValue(box(0))
    const compiled = compiledFixture()

    const { rerender } = renderHook(
      ({ compiled }: { compiled: Compiled }) => useLayout(compiled),
      { initialProps: { compiled } },
    )
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    // Mô phỏng kéo timeline: cha re-render 20 lần (stepIndex đổi trong store)
    // nhưng KHÔNG tạo `compiled` mới — đúng như useLabStore.setStep không đụng
    // tới trường `compiled`, nên effect (deps = compiled.revision) không chạy lại.
    for (let i = 0; i < 20; i++) rerender({ compiled })

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('đổi source (revision mới) gọi thêm đúng 1 lần', async () => {
    const spy = spyLayoutGraph().mockResolvedValue(box(0))
    const first = compiledFixture()

    const { rerender } = renderHook(
      ({ compiled }: { compiled: Compiled }) => useLayout(compiled),
      { initialProps: { compiled: first } },
    )
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    const second = compiledFixture()
    rerender({ compiled: second })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('kết quả CŨ về SAU kết quả MỚI thì bị vứt (hai promise resolve ngược thứ tự)', async () => {
    const stale = deferred<LayoutResult>()
    const fresh = deferred<LayoutResult>()
    const spy = spyLayoutGraph()
    spy.mockImplementationOnce(() => stale.promise)
    spy.mockImplementationOnce(() => fresh.promise)

    const older = compiledFixture()
    const { result, rerender } = renderHook(
      ({ compiled }: { compiled: Compiled }) => useLayout(compiled),
      { initialProps: { compiled: older } },
    )
    const newer = compiledFixture()
    rerender({ compiled: newer })
    expect(spy).toHaveBeenCalledTimes(2)

    const freshResult = box(9)
    const staleResult = box(1)

    // Kết quả MỚI về trước...
    await act(async () => { fresh.resolve(freshResult) })
    expect(result.current).toBe(freshResult)

    // ...rồi kết quả CŨ về sau — phải bị vứt, không được ghi đè kết quả mới.
    await act(async () => { stale.resolve(staleResult) })
    expect(result.current).toBe(freshResult)
  })

  it('unmount giữa chừng: kết quả về sau không setState, không có cảnh báo React', async () => {
    const pending = deferred<LayoutResult>()
    spyLayoutGraph().mockReturnValue(pending.promise)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const compiled = compiledFixture()
    const { unmount } = renderHook(() => useLayout(compiled))
    unmount()

    // Resolve sau khi unmount. Nếu hook thiếu guard, setState trên component
    // đã unmount sẽ khiến React log cảnh báo "not wrapped in act(...)" ra
    // console.error vì việc resolve này xảy ra ngoài phạm vi act() của lần
    // render ban đầu.
    await act(async () => { pending.resolve(box(5)) })

    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('spec rỗng không gọi ELK, trả map rỗng', () => {
    const spy = spyLayoutGraph()
    const compiled = compiledFixture(EMPTY_SPEC)

    const { result } = renderHook(() => useLayout(compiled))

    expect(spy).not.toHaveBeenCalled()
    expect(result.current).toEqual(new Map())
  })
})
