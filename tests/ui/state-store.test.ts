import { beforeEach, describe, expect, it } from 'vitest'
import { useLabStore } from '../../src/state/store'
import { selectWorld, selectCurrentLine, foldStats } from '../../src/state/selectors'

const SRC = 'fun main() = runBlocking {\n  launch { delay(100); println("A") }\n  delay(50)\n}\n'
const st = () => useLabStore.getState()

beforeEach(() => { useLabStore.setState({ source: '', stepIndex: 0, lessonId: null }); st().setSource(SRC) })

describe('store — trace là nguồn sự thật duy nhất', () => {
  it('setStep kẹp vào [0, số event]', () => {
    st().setStep(-5); expect(st().stepIndex).toBe(0)
    st().setStep(99999); expect(st().stepIndex).toBe(st().compiled.events.length)
  })

  it('TUA NGƯỢC cho world y hệt tiến thẳng — bất biến trung tâm của M2', () => {
    const n = st().compiled.events.length
    const forward: string[] = []
    for (let i = 0; i <= n; i++) { st().setStep(i); forward.push(JSON.stringify(snapshot())) }
    const backward: string[] = []
    for (let i = n; i >= 0; i--) { st().setStep(i); backward.unshift(JSON.stringify(snapshot())) }
    expect(backward).toEqual(forward)
  })

  it('nhảy thẳng tới step N = tua từng bước tới N', () => {
    const n = st().compiled.events.length
    for (let i = 0; i <= n; i++) st().setStep(i)
    const stepped = JSON.stringify(snapshot())
    st().setStep(0); st().setStep(n)
    expect(JSON.stringify(snapshot())).toBe(stepped)
  })

  it('source dở dang không làm vỡ store', () => {
    st().setSource('fun main() = runBlocking {')
    expect(st().compiled.diagnostics.length).toBeGreaterThan(0)
    expect(st().compiled.events).toEqual([])
    expect(st().stepIndex).toBe(0)
    expect(() => selectWorld(st())).not.toThrow()
  })

  it('loadLesson đặt source và đưa con trỏ về 0', () => {
    st().setStep(3)
    st().loadLesson('supervisor')
    expect(st().stepIndex).toBe(0)
    expect(st().lessonId).toBe('supervisor')
    expect(st().compiled.diagnostics).toEqual([])
  })

  it('id lesson lạ là no-op, không ném', () => {
    const before = st().source
    st().loadLesson('khong-co')
    expect(st().source).toBe(before)
  })
})

describe('selector — ổn định tham chiếu', () => {
  it('cùng stepIndex trả CÙNG MỘT tham chiếu, không gập lại', () => {
    st().setStep(4)
    const a = selectWorld(st())
    const before = foldStats.calls
    const b = selectWorld(st())
    expect(Object.is(a, b)).toBe(true)      // toEqual KHÔNG thấy được lỗi này
    expect(foldStats.calls).toBe(before)
  })

  it('đổi stepIndex thì gập lại đúng MỘT lần', () => {
    st().setStep(2); selectWorld(st())
    const before = foldStats.calls
    st().setStep(3); selectWorld(st()); selectWorld(st()); selectWorld(st())
    expect(foldStats.calls).toBe(before + 1)
  })

  it('selectCurrentLine đọc từ world, không tự tính lại', () => {
    st().setStep(st().compiled.events.length)
    expect(selectCurrentLine(st())).toBe(selectWorld(st()).srcLine)
  })
})

function snapshot() {
  const w = selectWorld(st())
  return { t: w.t, srcLine: w.srcLine, output: w.output,
    jobs: [...w.jobs.values()].map(j => [j.id, j.state, j.threadId, j.suspendReason]) }
}
