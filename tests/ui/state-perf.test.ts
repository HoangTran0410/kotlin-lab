import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

describe('rào chắn hiệu năng — kéo scrubber phải mượt', () => {
  it('gập trace lớn dưới 5ms — một khung 60fps là 16.7ms', () => {
    const r = runSourceSafe(
      'fun main() = runBlocking {\n  repeat(500) { i ->\n    launch { delay(10); println("job $i") }\n  }\n}\n')
    expect(r.diagnostics).toEqual([])
    expect(r.events.length).toBeGreaterThan(5000)

    foldTrace(r.events, r.events.length)   // làm nóng
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) foldTrace(r.events, r.events.length)
    const each = (performance.now() - t0) / 20

    // Đo lúc lập kế hoạch: 0.25ms ở 8k event, 0.49ms ở 16k. Ngưỡng 5ms là
    // rộng rãi 10x. Nếu test này đỏ thì foldTrace đã thành siêu tuyến tính,
    // và quyết định "không cần fold tăng dần" cần xem lại.
    expect(each).toBeLessThan(5)
  })
})
