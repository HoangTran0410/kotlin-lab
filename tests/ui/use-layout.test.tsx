import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Compiled } from '../../src/state/compile'
import type { GraphSpec } from '../../src/engine/trace/graph'
import type { LayoutResult } from '../../src/ui/graph/elkLayout'
import * as elkLayoutModule from '../../src/ui/graph/elkLayout'
import { useLayout } from '../../src/ui/graph/useLayout'

/**
 * `layoutGraph` is spied on at the MODULE level, not fully mocking ELK — the
 * hook imports it as a named import from this exact module, so overriding
 * `elkLayoutModule.layoutGraph` (Vitest transforms ESM into a spyable
 * binding) intercepts at exactly the point the effect in useLayout.ts
 * actually calls into.
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
/** Each call simulates exactly one `compile()` — a different revision every time. */
function compiledFixture(spec: GraphSpec = specWithNodes(1)): Compiled {
  return { events: [], diagnostics: [], spec, revision: nextRevision++ }
}

function box(x: number): LayoutResult {
  return new Map([['n0', { x, y: 0, width: 1, height: 1 }]])
}

/** A promise controllable from outside — sets up the "two results come back out of order" scenario. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLayout (Task 15) — ELK runs once per compile, resists stale results', () => {
  it('scrubbing through 20 "steps" (props unchanged) calls layoutGraph exactly once', async () => {
    const spy = spyLayoutGraph().mockResolvedValue(box(0))
    const compiled = compiledFixture()

    const { rerender } = renderHook(
      ({ compiled }: { compiled: Compiled }) => useLayout(compiled),
      { initialProps: { compiled } },
    )
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    // Simulates dragging the timeline: the parent re-renders 20 times
    // (stepIndex changes in the store) but does NOT create a new `compiled`
    // — matching how useLabStore.setStep never touches the `compiled` field,
    // so the effect (deps = compiled.revision) doesn't rerun.
    for (let i = 0; i < 20; i++) rerender({ compiled })

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('changing the source (new revision) calls it exactly one more time', async () => {
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

  it('a STALE result arriving AFTER a FRESH one gets discarded (two promises resolving out of order)', async () => {
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

    // The FRESH result arrives first...
    await act(async () => { fresh.resolve(freshResult) })
    expect(result.current).toBe(freshResult)

    // ...then the STALE result arrives after — must be discarded, must not overwrite the fresh result.
    await act(async () => { stale.resolve(staleResult) })
    expect(result.current).toBe(freshResult)
  })

  it("unmounting midway: a result arriving afterward doesn't setState, no React warning", async () => {
    const pending = deferred<LayoutResult>()
    spyLayoutGraph().mockReturnValue(pending.promise)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const compiled = compiledFixture()
    const { unmount } = renderHook(() => useLayout(compiled))
    unmount()

    // Resolves after unmount. If the hook is missing a guard, setState on an
    // already-unmounted component makes React log a "not wrapped in
    // act(...)" warning to console.error, because this resolution happens
    // outside the act() scope of the initial render.
    await act(async () => { pending.resolve(box(5)) })

    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("empty spec doesn't call ELK, returns an empty map", () => {
    const spy = spyLayoutGraph()
    const compiled = compiledFixture(EMPTY_SPEC)

    const { result } = renderHook(() => useLayout(compiled))

    expect(spy).not.toHaveBeenCalled()
    expect(result.current).toEqual(new Map())
  })
})
