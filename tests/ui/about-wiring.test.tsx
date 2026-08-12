import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { CHAY_DUOC } from '../../src/ui/about/capabilities'
import { UNSUPPORTED } from '../../src/engine/validator/diagnostics'
import { KOTLIN_VERSION } from '../../src/engine/kotlinVersion'

const mo = (): HTMLElement => {
  const nav = screen.getByRole('navigation', { name: 'Lộ trình bài học' })
  fireEvent.click(within(nav).getByRole('button', { name: 'Chạy được gì?' }))
  return screen.getByRole('dialog')
}

describe('trang giới thiệu — nối vào app', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
  })

  it('mặc định ĐÓNG — không chắn đường người đã biết mình đang làm gì', () => {
    render(<App />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('nói rõ phiên bản Kotlin mà ngữ nghĩa được đối chiếu vào', () => {
    render(<App />)
    expect(mo()).toHaveTextContent(KOTLIN_VERSION)
  })

  it('liệt kê đủ mọi mục chạy được, kèm output của từng ví dụ', () => {
    render(<App />)
    const hop = mo()
    for (const nhom of CHAY_DUOC) {
      for (const k of nhom.items) {
        expect(within(hop).getAllByText(k.ten).length, `thiếu mục ${k.ten}`).toBeGreaterThan(0)
        // Output là thứ chứng minh ví dụ chạy ra cái gì — thiếu nó thì thẻ chỉ
        // còn là một cái tên, đúng thứ mà trang này ra đời để thay thế.
        expect(hop.textContent, `${k.ten} không hiện output`).toContain(k.ra[0])
      }
    }
  })

  it('liệt kê đủ mọi construct CHƯA hỗ trợ, kèm gợi ý thay thế', () => {
    render(<App />)
    const hop = mo()
    for (const [ten, goiY] of Object.entries(UNSUPPORTED)) {
      expect(within(hop).getAllByText(ten).length, `thiếu ${ten}`).toBeGreaterThan(0)
      expect(hop.textContent, `${ten} thiếu gợi ý`).toContain(goiY)
    }
  })

  it('"Mở ví dụ" nạp mã CHẠY ĐƯỢC vào editor và đóng hộp', () => {
    render(<App />)
    const hop = mo()
    fireEvent.click(within(hop).getAllByRole('button', { name: 'Mở ví dụ' })[0]!)

    expect(screen.queryByRole('dialog'), 'hộp không tự đóng sau khi mở ví dụ').toBeNull()
    const st = useLabStore.getState()
    expect(st.source).toBe(CHAY_DUOC[0]!.items[0]!.kotlin)
    // Không chỉ "source đã đổi": mã phải BIÊN DỊCH SẠCH và SINH RA TRACE. Một
    // ví dụ nạp vào rồi báo đỏ ngay là tệ hơn không có nút này.
    expect(st.compiled.diagnostics).toEqual([])
    expect(st.compiled.events.length).toBeGreaterThan(0)
  })

  it('mở ví dụ thì bỏ đánh dấu bài đang học — header không nói nhầm', () => {
    render(<App />)
    // Chọn một bài qua ĐÚNG đường người dùng đi: mở hộp, tab Lộ trình, bấm thẻ.
    const nav = screen.getByRole('navigation', { name: 'Lộ trình bài học' })
    fireEvent.click(within(nav).getAllByRole('button')[0]!)
    const loTrinh = screen.getByRole('dialog')
    fireEvent.click(loTrinh.querySelectorAll<HTMLButtonElement>('.les__card')[0]!)
    expect(useLabStore.getState().lessonId).not.toBeNull()

    const hop = mo()
    fireEvent.click(within(hop).getAllByRole('button', { name: 'Mở ví dụ' })[0]!)
    expect(useLabStore.getState().lessonId, 'chip bài cũ vẫn sáng dù editor đã là mã khác').toBeNull()
  })

  it('Escape đóng hộp', () => {
    render(<App />)
    mo()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
