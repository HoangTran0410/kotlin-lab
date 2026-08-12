import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { LessonNav } from '../../src/ui/lessons/LessonNav'
import { LESSON_LIST } from '../../src/lessons/registry'
import { runSourceSafe } from '../../src/engine/run'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'

describe('LessonNav', () => {
  it('hiện đủ mọi bài, đúng thứ tự order, số thứ tự và tooltip đầy đủ', () => {
    const { container } = render(
      <LessonNav currentLessonId={null} loadLesson={() => {}} setSource={() => {}} />,
    )
    const items = container.querySelectorAll<HTMLButtonElement>('.lesson-nav__item')
    expect(items).toHaveLength(LESSON_LIST.length)
    expect(LESSON_LIST.length, 'nav phải liệt kê đủ 9 bài').toBe(9)
    // Chip chỉ hiện SỐ + nhãn ngắn (9 bài không xếp vừa một hàng nếu hiện cả
    // summary), nhưng title/summary đầy đủ vẫn phải tới được người dùng — qua
    // tooltip. Canh cả hai: số thứ tự đúng, và không bài nào mất chữ.
    expect([...items].map(b => b.querySelector('.lesson-nav__num')?.textContent))
      .toEqual(LESSON_LIST.map(l => String(l.order)))
    for (const [i, b] of [...items].entries()) {
      const l = LESSON_LIST[i]!
      expect(b.getAttribute('title'), `${l.id} mất title/summary trong tooltip`)
        .toBe(`${l.title}\n${l.summary}`)
    }
  })

  it('bấm vào một bài gọi loadLesson với đúng id', () => {
    const loadLesson = vi.fn()
    const { container } = render(
      <LessonNav currentLessonId={null} loadLesson={loadLesson} setSource={() => {}} />,
    )
    const items = container.querySelectorAll<HTMLButtonElement>('.lesson-nav__item')
    fireEvent.click(items[1]!)
    expect(loadLesson).toHaveBeenCalledTimes(1)
    expect(loadLesson).toHaveBeenCalledWith(LESSON_LIST[1]!.id)
  })

  it('đánh dấu đúng bài đang mở, không đánh dấu các bài còn lại', () => {
    const openId = LESSON_LIST[2]!.id
    const { container } = render(
      <LessonNav currentLessonId={openId} loadLesson={() => {}} setSource={() => {}} />,
    )
    const items = [...container.querySelectorAll<HTMLButtonElement>('.lesson-nav__item')]
    const active = items.filter(b => b.classList.contains('lesson-nav__item--active'))
    expect(active).toHaveLength(1)
    expect(active[0]!.getAttribute('aria-current')).toBe('true')
    expect(active[0]!.getAttribute('title')).toContain(LESSON_LIST[2]!.title)
  })

  it('bấm vào một bài (qua store thật) đưa stepIndex về 0', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('jobtree')!)
    useLabStore.getState().setStep(3)
    expect(useLabStore.getState().stepIndex, 'fixture phải cho phép stepIndex khác 0 trước khi bấm').toBe(3)

    const { container } = render(
      <LessonNav
        currentLessonId={useLabStore.getState().lessonId}
        loadLesson={useLabStore.getState().loadLesson}
        setSource={useLabStore.getState().setSource}
      />,
    )
    const supervisorIdx = LESSON_LIST.findIndex(l => l.id === 'supervisor')
    const items = container.querySelectorAll<HTMLButtonElement>('.lesson-nav__item')
    fireEvent.click(items[supervisorIdx]!)

    expect(useLabStore.getState().stepIndex).toBe(0)
    expect(useLabStore.getState().lessonId).toBe('supervisor')
  })

  it('nút "Bắt đầu từ trang trắng" đặt source compile sạch, không diagnostic', () => {
    const setSource = vi.fn()
    const { container } = render(
      <LessonNav currentLessonId="jobtree" loadLesson={() => {}} setSource={setSource} />,
    )
    const blankBtn = container.querySelector<HTMLButtonElement>('.lesson-nav__blank')
    if (!blankBtn) throw new Error('không tìm thấy nút trang trắng')
    fireEvent.click(blankBtn)

    expect(setSource).toHaveBeenCalledTimes(1)
    const blankSrc = setSource.mock.calls[0]![0] as string
    expect(runSourceSafe(blankSrc).diagnostics).toEqual([])
  })
})
