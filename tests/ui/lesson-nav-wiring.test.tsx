import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { runSourceSafe } from '../../src/engine/run'

/**
 * "Nối dây": test dựng LessonNav/LessonList TRỰC TIẾP (lesson-nav.test.tsx)
 * không bắt được lỗi kiểu "App quên mount nav vào slot của Shell" hay "App
 * truyền nhầm loadLesson của một store khác". Chỉ ở đây, với <App/> ghép thật,
 * bấm DOM thật mới lộ loại lỗi đó.
 *
 * QUAN TRỌNG: App có RẤT NHIỀU <button> — mọi query dưới đây bị SCOPE vào nav
 * hoặc vào hộp (role="dialog"), không bao giờ `getByRole('button')` trần.
 */
const moLoTrinh = (): HTMLElement => {
  const nav = screen.getByRole('navigation', { name: 'Lộ trình bài học' })
  fireEvent.click(within(nav).getAllByRole('button')[0]!)
  return screen.getByRole('dialog')
}

describe('nối dây App -> lộ trình bài học', () => {
  it('bấm một bài nạp đúng source thật, đúng lessonId, kẹp stepIndex về 0, và đóng hộp', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('jobtree')!)
    useLabStore.getState().setStep(2)
    render(<App />)

    const hop = moLoTrinh()
    const cards = [...hop.querySelectorAll<HTMLButtonElement>('.les__card')]
    expect(cards, 'hộp phải có đúng một thẻ cho mỗi bài').toHaveLength(LESSON_LIST.length)

    const target = cards[LESSON_LIST.findIndex(l => l.id === 'supervisor')]!
    fireEvent.click(target)

    expect(useLabStore.getState().lessonId).toBe('supervisor')
    expect(useLabStore.getState().source).toBe(lessonSource('supervisor'))
    expect(useLabStore.getState().stepIndex).toBe(0)
    expect(screen.queryByRole('dialog'), 'hộp không tự đóng sau khi chọn bài').toBeNull()
  })

  it('header hiện tên bài vừa chọn — không phải chỉ một chấm màu', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    render(<App />)
    const hop = moLoTrinh()
    const idx = LESSON_LIST.findIndex(l => l.id === 'parallel')
    fireEvent.click([...hop.querySelectorAll<HTMLButtonElement>('.les__card')][idx]!)

    const nav = screen.getByRole('navigation', { name: 'Lộ trình bài học' })
    expect(nav).toHaveTextContent(LESSON_LIST[idx]!.title)
  })

  it('hai tab nằm trong CÙNG một hộp, chuyển qua lại không phải đóng mở', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    render(<App />)
    const hop = moLoTrinh()
    expect(within(hop).getAllByRole('tab')).toHaveLength(2)

    fireEvent.click(within(hop).getByRole('tab', { name: 'Chạy được gì?' }))
    // Vẫn đúng một hộp, và nội dung đã đổi sang tab kia.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog')).toHaveTextContent('Chưa chạy được')
  })

  it('bấm "Bắt đầu từ trang trắng" nạp source thật vào store, compile sạch', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)

    const before = useLabStore.getState().source
    const nav = screen.getByRole('navigation', { name: 'Lộ trình bài học' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Bắt đầu từ trang trắng' }))

    const src = useLabStore.getState().source
    expect(src, 'source phải thật sự đổi, không phải no-op').not.toBe(before)
    expect(runSourceSafe(src).diagnostics).toEqual([])
  })
})
