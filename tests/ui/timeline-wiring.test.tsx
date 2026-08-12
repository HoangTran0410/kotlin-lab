import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { openDebug } from './helpers/openDebug'

/**
 * "Nối dây" theo đúng bài học của Task 9/13 (xem current-line-wiring.test.tsx,
 * graph-canvas.test.tsx): test dựng Timeline.tsx TRỰC TIẾP (timeline.test.tsx)
 * không thể bắt lỗi kiểu "App quên truyền compiled.events/stepIndex/setStep
 * thật vào Timeline" hay "Panel timeline vẫn còn là đoạn text placeholder cũ".
 * Chỉ có ở đây, với <App /> ghép thật, kéo DOM mới thật sự lái store thật.
 */
describe('nối dây App -> Timeline — kéo DOM thật đổi stepIndex thật của store, cả hai chiều', () => {
  it('kéo range input tới 10 rồi lùi về 3 đổi đúng store.stepIndex, giữ vị trí node cố định', async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)
    openDebug()

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture supervisor cần có event để test có ý nghĩa').toBeGreaterThan(10)

    const range = screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement
    expect(range.max).toBe(String(total))

    // useLayout (Task 15) chạy ELK trong useEffect; kết quả về qua MỘT
    // microtask (`layoutGraph(...).then(...)`) chưa từng flush chỉ vì
    // render()/fireEvent đã chạy. Round trước (fix round 1) đo được: bỏ
    // `waitFor` này, `.react-flow__node` querySelectorAll trả về RỖNG ở cả
    // hai điểm chụp bên dưới, và `expect(positionsAgain).toEqual(positionsAt10)`
    // xanh vì so `[] === []` — không kiểm tra được gì. Phải đợi node xuất
    // hiện thật trước khi chụp vị trí tham chiếu.
    await waitFor(() => {
      expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0)
    })

    fireEvent.change(range, { target: { value: '10' } })
    expect(useLabStore.getState().stepIndex).toBe(10)

    const positionsAt10 = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform] as const)
    // Bất-vô-nghĩa: nếu mảng này rỗng thì so sánh bên dưới xanh dù không kiểm
    // tra gì cả (từng xảy ra thật, xem ghi chú `waitFor` ở trên). Ép có node
    // thật trước khi tin bất kỳ so sánh nào dựa trên mảng này.
    expect(positionsAt10.length, 'phải chụp được vị trí node THẬT, không phải mảng rỗng').toBeGreaterThan(0)

    // Kéo NGƯỢC — đây chính là tính năng cả milestone tồn tại để cho phép.
    fireEvent.change(range, { target: { value: '3' } })
    expect(useLabStore.getState().stepIndex).toBe(3)

    const positionsAt3 = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform] as const)
    expect(positionsAt3.length, 'fixture: cần ít nhất 1 node đã sinh ra ở step 3').toBeGreaterThan(0)

    // Bất biến chống rung THẬT — khác với vòng kéo-tới-rồi-lùi-về-CÙNG-step ở
    // trên (vốn chỉ nhạy với lỗi kiểu "App quên nối dây lại", KHÔNG nhạy với
    // lỗi "vị trí tính lại theo subgraph mỗi step": world.jobs.size tại step 3
    // và step 10 khác nhau, nhưng cả hai lần vẫn tự nhất quán với chính nó, nên
    // so sánh step-với-chính-nó không bao giờ đỏ dưới lỗi đó — đã tự đo bằng
    // Phá 3 của task-20-report.md, fix round 1). Node nào đã sinh ra ở CẢ hai
    // step (ở đây: root, sinh sớm nhất) phải mang CÙNG toạ độ dù xem từ step
    // nào — layout cố định một lần cho cả trace, không phải bố cục lại theo
    // tập node đang có tại step đang xem.
    const at10ById = new Map(positionsAt10)
    for (const [id, transform] of positionsAt3) {
      expect(at10ById.get(id), `node ${id}: toạ độ ở step 3 phải khớp step 10`).toBe(transform)
    }

    fireEvent.change(range, { target: { value: '10' } })
    expect(useLabStore.getState().stepIndex).toBe(10)
    const positionsAgain = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform])
    expect(positionsAgain.length, 'phải chụp được vị trí node THẬT, không phải mảng rỗng').toBeGreaterThan(0)

    // Bất biến chống rung (Task 11/12): quay lại CÙNG step thì vị trí node
    // (tính bởi layout cố định, không phải world theo-step) phải y hệt.
    expect(positionsAgain).toEqual(positionsAt10)
  })

  it('phím ← tại App thật lùi đúng một step qua store thật', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    act(() => { useLabStore.getState().setStep(5) })

    const range = screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    expect(useLabStore.getState().stepIndex).toBe(4)
  })
})
