import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LessonNav } from '../../src/ui/lessons/LessonNav'
import { LessonList } from '../../src/ui/lessons/LessonList'
import { LESSON_IDS_DOI_CHIEU_JVM, LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { runSourceSafe } from '../../src/engine/run'

const navProps = {
  currentLessonId: null, onMoLoTrinh: () => {}, onMoGioiThieu: () => {}, setSource: () => {},
}

describe('LessonNav — ba lối vào trong header', () => {
  it('chưa mở bài nào thì mời chọn, và nói rõ có bao nhiêu bài', () => {
    render(<LessonNav {...navProps} />)
    const mo = screen.getByRole('button', { name: new RegExp(`Chọn bài.*${LESSON_LIST.length} bài`) })
    expect(mo).toBeInTheDocument()
  })

  it('đang mở một bài thì hiện SỐ và TIÊU ĐỀ của đúng bài đó', () => {
    // Dải chip cũ chỉ nói được "bài nào đang mở" bằng màu nền của một chip nhỏ
    // — mà chip đó có thể đang nằm ngoài vùng cuộn.
    const bai = LESSON_LIST[4]!
    render(<LessonNav {...navProps} currentLessonId={bai.id} />)
    const mo = screen.getByRole('button', { name: new RegExp(bai.title) })
    expect(mo).toHaveTextContent(String(bai.order))
  })

  it('hai nút mở hai tab khác nhau của cùng một hộp', () => {
    const onMoLoTrinh = vi.fn()
    const onMoGioiThieu = vi.fn()
    render(<LessonNav {...navProps} onMoLoTrinh={onMoLoTrinh} onMoGioiThieu={onMoGioiThieu} />)
    fireEvent.click(screen.getByRole('button', { name: /Chọn bài/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Chạy được gì?' }))
    expect(onMoLoTrinh).toHaveBeenCalledTimes(1)
    expect(onMoGioiThieu).toHaveBeenCalledTimes(1)
  })

  it('"Bắt đầu từ trang trắng" đặt source compile sạch', () => {
    const setSource = vi.fn()
    render(<LessonNav {...navProps} setSource={setSource} />)
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu từ trang trắng' }))
    expect(setSource).toHaveBeenCalledTimes(1)
    const src = setSource.mock.calls[0]![0] as string
    expect(runSourceSafe(src).diagnostics).toEqual([])
  })
})

describe('LessonList — cả lộ trình, không giấu bài nào', () => {
  it('hiện ĐỦ mọi bài, không cắt bớt', () => {
    // Chính là lỗi của bản trước: dải chip `max-width: 60vw; overflow-x: auto`
    // nên chỉ khoảng 8/13 bài lọt vào tầm nhìn, phần còn lại không dấu vết.
    const { container } = render(<LessonList currentLessonId={null} onChon={() => {}} />)
    expect(container.querySelectorAll('.les__card')).toHaveLength(LESSON_LIST.length)
  })

  it('mỗi thẻ mang đủ số, tiêu đề, tóm tắt và khái niệm — không giấu vào tooltip', () => {
    const { container } = render(<LessonList currentLessonId={null} onChon={() => {}} />)
    const cards = [...container.querySelectorAll<HTMLElement>('.les__card')]
    for (const [i, card] of cards.entries()) {
      const l = LESSON_LIST[i]!
      expect(card).toHaveTextContent(String(l.order))
      expect(card).toHaveTextContent(l.title)
      expect(card, `${l.id} mất tóm tắt`).toHaveTextContent(l.summary)
      for (const c of l.concepts) {
        expect(within(card).getByText(c), `${l.id} thiếu khái niệm ${c}`).toBeInTheDocument()
      }
    }
  })

  it('đánh dấu bài đang mở, đúng MỘT bài', () => {
    const id = LESSON_LIST[2]!.id
    const { container } = render(<LessonList currentLessonId={id} onChon={() => {}} />)
    const on = container.querySelectorAll('.les__card--on')
    expect(on).toHaveLength(1)
    expect(on[0]!.getAttribute('aria-current')).toBe('true')
    expect(on[0]!).toHaveTextContent(LESSON_LIST[2]!.title)
  })

  it('bấm một thẻ gọi onChon với đúng id', () => {
    const onChon = vi.fn()
    const { container } = render(<LessonList currentLessonId={null} onChon={onChon} />)
    const cards = container.querySelectorAll<HTMLButtonElement>('.les__card')
    const idx = LESSON_LIST.findIndex(l => l.id === 'supervisor')
    fireEvent.click(cards[idx]!)
    expect(onChon).toHaveBeenCalledWith('supervisor')
  })

  it('dấu JVM chỉ nằm trên bài THẬT SỰ có fixture', () => {
    // Dấu này nói về độ tin cậy của bài. Gắn bừa cho cả 13 bài thì nó thành
    // trang trí, và người học tin nhầm vào 4 bài chưa được so.
    const { container } = render(<LessonList currentLessonId={null} onChon={() => {}} />)
    const cards = [...container.querySelectorAll<HTMLElement>('.les__card')]
    const coDau = cards.filter(c => c.querySelector('.les__jvm') !== null).length
    expect(coDau).toBe(LESSON_LIST.filter(l => LESSON_IDS_DOI_CHIEU_JVM.has(l.id)).length)
    expect(coDau, 'không bài nào có dấu — fixture không được nhận ra').toBeGreaterThan(0)
    expect(coDau, 'mọi bài đều có dấu — dấu thành vô nghĩa').toBeLessThan(LESSON_LIST.length)
  })

  it('mọi bài trong danh sách đều nạp được source thật', () => {
    for (const l of LESSON_LIST) {
      expect(lessonSource(l.id), `${l.id} không có source`).not.toBeNull()
    }
  })
})
