import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { runSourceSafe } from '../../src/engine/run'

/**
 * "Nối dây" theo đúng bài học Task 8/9/10/16/17: test dựng LessonNav TRỰC
 * TIẾP (lesson-nav.test.tsx) không thể bắt lỗi kiểu "App quên mount
 * LessonNav vào slot nav của Shell" hay "App truyền nhầm loadLesson/setSource
 * của một store khác". Chỉ ở đây, với <App/> ghép thật, bấm DOM thật mới lộ
 * loại lỗi đó.
 *
 * QUAN TRỌNG (cảnh báo từ round trước): App giờ có RẤT NHIỀU <button> — mọi
 * query dưới đây bị SCOPE vào `nav` (role="navigation", tên "Bài học") hoặc
 * lọc theo tên chính xác, không bao giờ `getByRole('button')` trần.
 */
describe('nối dây App -> LessonNav — bấm DOM thật lái store thật', () => {
  it('bấm một lesson nạp đúng source thật, đúng lessonId, và kẹp stepIndex về 0', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('jobtree')!)
    useLabStore.getState().setStep(2)
    render(<App />)

    const nav = screen.getByRole('navigation', { name: 'Bài học' })
    const items = within(nav).getAllByRole('button').filter(b => b.className.includes('lesson-nav__item'))
    expect(items, 'phải có đúng ba nút lesson trong nav').toHaveLength(3)

    const supervisor = LESSON_LIST.find(l => l.id === 'supervisor')!
    const target = items.find(b => b.textContent?.includes(supervisor.title))
    if (!target) throw new Error('không tìm thấy nút lesson supervisor')
    fireEvent.click(target)

    expect(useLabStore.getState().lessonId).toBe('supervisor')
    expect(useLabStore.getState().source).toBe(lessonSource('supervisor'))
    expect(useLabStore.getState().stepIndex).toBe(0)
  })

  it('bấm "Bắt đầu từ trang trắng" nạp source thật vào store, compile sạch', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)

    const before = useLabStore.getState().source
    const nav = screen.getByRole('navigation', { name: 'Bài học' })
    const blankBtn = within(nav).getByRole('button', { name: 'Bắt đầu từ trang trắng' })
    fireEvent.click(blankBtn)

    const src = useLabStore.getState().source
    expect(src, 'source phải thật sự đổi, không phải no-op').not.toBe(before)
    expect(runSourceSafe(src).diagnostics).toEqual([])
  })
})
