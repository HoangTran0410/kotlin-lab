import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

describe('performance guardrail — dragging the scrubber must stay smooth', () => {
  it('folds a large trace under 5ms — one 60fps frame is 16.7ms', () => {
    const r = runSourceSafe(
      'fun main() = runBlocking {\n  repeat(500) { i ->\n    launch { delay(10); println("job $i") }\n  }\n}\n')
    expect(r.diagnostics).toEqual([])
    expect(r.events.length).toBeGreaterThan(5000)

    foldTrace(r.events, r.events.length)   // warm up
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) foldTrace(r.events, r.events.length)
    const each = (performance.now() - t0) / 20

    // Measured during planning: 0.25ms at 8k events, 0.49ms at 16k. The 5ms
    // threshold gives a generous 10x margin. If this test goes red, foldTrace
    // has become superlinear, and the decision "no incremental fold needed"
    // needs revisiting.
    expect(each).toBeLessThan(5)
  })
})
