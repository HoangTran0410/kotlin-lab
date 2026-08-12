import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'

/**
 * "Nối dây" theo đúng bài học của Task 9/13 (xem current-line-wiring.test.tsx,
 * graph-canvas.test.tsx): test dựng Timeline.tsx TRỰC TIẾP (timeline.test.tsx)
 * không thể bắt lỗi kiểu "App quên truyền compiled.events/stepIndex/setStep
 * thật vào Timeline" hay "Panel timeline vẫn còn là đoạn text placeholder cũ".
 * Chỉ có ở đây, với <App /> ghép thật, kéo DOM mới thật sự lái store thật.
 */
describe('nối dây App -> Timeline — kéo DOM thật đổi stepIndex thật của store, cả hai chiều', () => {
  it('kéo range input tới 10 rồi lùi về 3 đổi đúng store.stepIndex, giữ vị trí node cố định', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture supervisor cần có event để test có ý nghĩa').toBeGreaterThan(10)

    const range = screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement
    expect(range.max).toBe(String(total))

    fireEvent.change(range, { target: { value: '10' } })
    expect(useLabStore.getState().stepIndex).toBe(10)

    const positionsAt10 = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform])

    // Kéo NGƯỢC — đây chính là tính năng cả milestone tồn tại để cho phép.
    fireEvent.change(range, { target: { value: '3' } })
    expect(useLabStore.getState().stepIndex).toBe(3)

    fireEvent.change(range, { target: { value: '10' } })
    expect(useLabStore.getState().stepIndex).toBe(10)
    const positionsAgain = [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map(el => [el.dataset.id, el.style.transform])

    // Bất biến chống rung (Task 11/12): quay lại CÙNG step thì vị trí node
    // (tính bởi layout cố định, không phải world theo-step) phải y hệt.
    expect(positionsAgain).toEqual(positionsAt10)
  })

  it('phím ← tại App thật lùi đúng một step qua store thật', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    act(() => { useLabStore.getState().setStep(5) })

    const range = screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    expect(useLabStore.getState().stepIndex).toBe(4)
  })
})
