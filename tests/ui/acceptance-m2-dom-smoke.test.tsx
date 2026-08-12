import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'

/**
 * THAY THẾ CHO PLAYWRIGHT (Task 20 Step 3) — không có browser thật ở môi
 * trường này (đã xác nhận từ các task trước, xem task-20-report.md). Bốn
 * khẳng định của `e2e/scrub.spec.ts` trong brief cần một trình duyệt THẬT: nó
 * đo `boundingBox` bằng layout engine thật của Chromium, còn ở đây jsdom
 * KHÔNG có layout engine — `getBoundingClientRect` luôn trả về 0 (xem ghi chú
 * gốc trong tests/ui/setup.ts và tests/ui/graph-canvas.test.tsx).
 *
 * File này đứng gần nhất có thể tới bốn khẳng định đó TRONG jsdom: mount
 * `<App/>` THẬT (không mock store, không mock ReactFlow), lái store bằng
 * chính API mà LessonNav/Timeline thật gọi, và đọc `style.transform` — thuộc
 * tính duy nhất mà React Flow dùng để đặt vị trí (xem GraphCanvas.tsx,
 * graph-canvas.test.tsx đã khoá điều này) — thay cho `boundingBox`.
 *
 * Việc KHÔNG chứng minh được ở đây, phải chờ browser thật:
 *   - `boundingBox` thật (kích thước sau layout CSS thật, ảnh hưởng bởi font,
 *     zoom, ELK width/height thật sự khớp với DOM hay không).
 *   - Bất kỳ hiệu ứng CSS/animation nào chỉ chạy qua compositor thật.
 *   - Tương tác con trỏ thật (kéo bằng chuột) thay vì `fireEvent.change`.
 */
afterEach(() => {
  cleanup()
  useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
})

/**
 * `useLayout` (Task 15) chạy ELK trong `useEffect`, kết quả về qua MỘT
 * microtask (`layoutGraph(...).then(...)`) — chưa từng flush trong lúc thân
 * hàm test còn đang chạy đồng bộ, kể cả sau `render()`/`fireEvent`. Đo được
 * bằng chính file này: bỏ `waitFor` dưới đây, cả hai `it` đỏ với "0 node" —
 * `toReactFlow` bỏ qua MỌI node khi `layout` còn là Map rỗng (xem
 * toReactFlow.ts: `if (!box) continue`), nên ReactFlow mount ra 0 node và mọi
 * so sánh vị trí sau đó xanh RỖNG TUẾCH (mảng `[]` so `[]`). Phải đợi ELK
 * xong TRƯỚC KHI chụp vị trí tham chiếu, nếu không bài test này không kiểm
 * tra được gì cả — im lặng xanh giả.
 */
async function loadAndRender(id: string): Promise<number> {
  useLabStore.getState().setSource(lessonSource(id)!)
  render(<App />)
  const total = useLabStore.getState().compiled.events.length
  expect(total, `fixture ${id} cần có event`).toBeGreaterThan(0)
  await waitFor(() => {
    expect(document.body.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0)
  })
  return total
}

function nodePositions(container: HTMLElement): Map<string, string> {
  const map = new Map<string, string>()
  for (const el of container.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const id = el.dataset.id
    if (id !== undefined) map.set(id, el.style.transform)
  }
  return map
}

/** borderTopColor của JobNode (leaf) mã hoá state — xem JobNode.tsx/nodeStyle.ts. */
function jobBorderColors(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="job-node"]')].map(
    el => el.style.borderTopColor,
  )
}

describe('SMOKE DOM (jsdom) — thay Playwright, App thật + store thật', () => {
  it('supervisor: graph render >=5 node, console 2 dòng ở cuối, rỗng khi lùi về 0, vị trí node bất biến khi tua', async () => {
    const total = await loadAndRender('supervisor')

    const container = document.body
    const nodesAtMount = container.querySelectorAll('.react-flow__node')
    expect(nodesAtMount.length, 'supervisor cần >=5 node trên graph').toBeGreaterThanOrEqual(5)

    act(() => { useLabStore.getState().setStep(total) })
    const region = screen.getByRole('region', { name: 'Console & chẩn đoán' })
    expect(within(region).getAllByText(/^t=/)).toHaveLength(2)
    expect(within(region).getByText('A xong')).toBeInTheDocument()
    expect(within(region).getByText('C xong')).toBeInTheDocument()

    // Đúng hai node launch Completed, một node launch Cancelled — nhìn thấy
    // được qua màu viền thật trên DOM thật, không chỉ trên dữ liệu thuần.
    const colorsAtEnd = jobBorderColors(container)
    expect(colorsAtEnd.filter(c => c === 'var(--state-completed)')).toHaveLength(2)
    expect(colorsAtEnd.filter(c => c === 'var(--state-cancelled)')).toHaveLength(1)

    const ref = nodePositions(container)
    expect(ref.size, 'cần bắt được vị trí node ở cuối trace').toBeGreaterThanOrEqual(5)

    // Tua QUA MỌI STEP tiến rồi lùi (không chỉ hai điểm mẫu) — vị trí node
    // (style.transform, do React Flow đặt trực tiếp từ layout cố định) phải
    // y hệt ở MỌI step, không riêng ở step cuối.
    for (let n = 0; n <= total; n++) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `supervisor tiến @${n} node ${id}`).toBe(transform)
    }
    for (let n = total; n >= 0; n--) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `supervisor lùi @${n} node ${id}`).toBe(transform)
    }

    // Lùi hẳn về 0: console phải rỗng trở lại (chống rung không có nghĩa là
    // "đứng yên luôn" — dữ liệu HIỂN THỊ vẫn phải đổi đúng theo step).
    act(() => { useLabStore.getState().setStep(0) })
    expect(within(region).getByText('Chưa có output.')).toBeInTheDocument()

    // Về lại cuối: vị trí node phải khớp tham chiếu ban đầu — không rung sau
    // một vòng tua đầy đủ.
    act(() => { useLabStore.getState().setStep(total) })
    const positionsAgain = nodePositions(container)
    for (const [id, transform] of ref) expect(positionsAgain.get(id), `supervisor cuối vòng node ${id}`).toBe(transform)
  })

  it('normalfail: console 0 dòng ở cuối, cả ba launch Cancelled, vị trí node bất biến khi tua', async () => {
    const total = await loadAndRender('normalfail')
    const container = document.body

    act(() => { useLabStore.getState().setStep(total) })
    const region = screen.getByRole('region', { name: 'Console & chẩn đoán' })
    expect(within(region).getByText('Chưa có output.')).toBeInTheDocument()

    const colorsAtEnd = jobBorderColors(container)
    expect(colorsAtEnd.length, 'normalfail cần 3 node launch').toBe(3)
    expect(colorsAtEnd.every(c => c === 'var(--state-cancelled)'), colorsAtEnd.join(',')).toBe(true)

    const ref = nodePositions(container)
    for (let n = 0; n <= total; n++) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `normalfail tiến @${n} node ${id}`).toBe(transform)
    }
    for (let n = total; n >= 0; n--) {
      act(() => { useLabStore.getState().setStep(n) })
      const positions = nodePositions(container)
      for (const [id, transform] of ref) expect(positions.get(id), `normalfail lùi @${n} node ${id}`).toBe(transform)
    }
  })
})
