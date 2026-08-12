import { beforeEach, describe, expect, it } from 'vitest'
import { useLabStore } from '../../src/state/store'
import { selectWorld, selectCurrentLine, foldStats } from '../../src/state/selectors'
import { lessonSource } from '../../src/lessons/registry'

const SRC = 'fun main() = runBlocking {\n  launch { delay(100); println("A") }\n  delay(50)\n}\n'
const st = () => useLabStore.getState()

beforeEach(() => { useLabStore.setState({ source: '', stepIndex: 0, lessonId: null }); st().setSource(SRC) })

describe('store — the trace is the one source of truth', () => {
  it('setStep clamps into [0, event count]', () => {
    st().setStep(-5); expect(st().stepIndex).toBe(0)
    st().setStep(99999); expect(st().stepIndex).toBe(st().compiled.events.length)
  })

  it('SCRUBBING BACKWARDS gives the same world as going forward — the central invariant of M2', () => {
    const n = st().compiled.events.length
    const forward: string[] = []
    for (let i = 0; i <= n; i++) { st().setStep(i); forward.push(JSON.stringify(snapshot())) }
    const backward: string[] = []
    for (let i = n; i >= 0; i--) { st().setStep(i); backward.unshift(JSON.stringify(snapshot())) }
    expect(backward).toEqual(forward)
  })

  it('jumping straight to step N = stepping one by one to N', () => {
    const n = st().compiled.events.length
    for (let i = 0; i <= n; i++) st().setStep(i)
    const stepped = JSON.stringify(snapshot())
    st().setStep(0); st().setStep(n)
    expect(JSON.stringify(snapshot())).toBe(stepped)
  })

  it('unfinished source does not break the store', () => {
    st().setSource('fun main() = runBlocking {')
    expect(st().compiled.diagnostics.length).toBeGreaterThan(0)
    expect(st().compiled.events).toEqual([])
    expect(st().stepIndex).toBe(0)
    expect(() => selectWorld(st())).not.toThrow()
  })

  it('loadLesson sets the source and resets the cursor to 0', () => {
    st().setStep(3)
    st().loadLesson('supervisor')
    expect(st().stepIndex).toBe(0)
    expect(st().lessonId).toBe('supervisor')
    expect(st().compiled.diagnostics).toEqual([])
  })

  it('an unknown lesson id is a no-op, does not throw', () => {
    const before = st().source
    st().loadLesson('does-not-exist')
    expect(st().source).toBe(before)
  })

  it('switching to SHORTER source while at the end must clamp stepIndex back down', () => {
    // No other test exercises this scenario: every beforeEach resets stepIndex
    // to 0 right before the one setSource call. And foldTrace clamps upTo
    // internally, so the program does NOT throw — it just quietly shows the
    // final state of the new trace. That's exactly the kind of bug that shows
    // up later as a "blank screen".
    st().setSource(lessonSource('supervisor')!)
    const long = st().compiled.events.length
    st().setStep(long)
    expect(st().stepIndex).toBe(long)

    st().setSource('fun main() = runBlocking { println("short") }')
    const short = st().compiled.events.length

    // Pin down that the fixture is ACTUALLY shorter — otherwise this test
    // itself is meaningless, a mistake that's happened four times already in
    // this project.
    expect(short, 'the fixture must be shorter for this test to mean anything').toBeLessThan(long)
    expect(st().stepIndex).toBeLessThanOrEqual(short)
  })
})

describe('selector — reference stability', () => {
  it('the same stepIndex returns the SAME reference, no refold', () => {
    st().setStep(4)
    const a = selectWorld(st())
    const before = foldStats.calls
    const b = selectWorld(st())
    expect(Object.is(a, b)).toBe(true)      // toEqual would NOT catch this bug
    expect(foldStats.calls).toBe(before)
  })

  it('changing stepIndex refolds exactly ONCE', () => {
    st().setStep(2); selectWorld(st())
    const before = foldStats.calls
    st().setStep(3); selectWorld(st()); selectWorld(st()); selectWorld(st())
    expect(foldStats.calls).toBe(before + 1)
  })

  it('selectCurrentLine reads from world, does not recompute on its own', () => {
    st().setStep(st().compiled.events.length)
    expect(selectCurrentLine(st())).toBe(selectWorld(st()).srcLine)
  })
})

function snapshot() {
  const w = selectWorld(st())
  return { t: w.t, srcLine: w.srcLine, output: w.output,
    jobs: [...w.jobs.values()].map(j => [j.id, j.state, j.threadId, j.suspendReason]) }
}
