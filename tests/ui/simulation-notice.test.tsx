import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { Shell } from '../../src/ui/layout/Shell'
import { useLabStore } from '../../src/state/store'

// Shell đòi đủ 5 vùng ReactNode; các test dưới chỉ quan tâm SimulationNotice
// nên truyền placeholder rỗng cho phần còn lại.
const shellProps = {
  debugOpen: true, nav: null, editor: null, graph: null, timeline: null, side: null,
  onMoGioiThieu: () => {},
}

describe('ghi chú mô phỏng — thường trực', () => {
  it('hiện ngay khi mở app', () => {
    render(<App />)
    expect(screen.getByRole('note')).toHaveTextContent(/deterministic/i)
  })

  it('nói rõ Kotlin thật có thể xen kẽ khác', () => {
    render(<App />)
    expect(screen.getByRole('note')).toHaveTextContent(/xen kẽ khác/)
  })

  it('KHÔNG có nút đóng — không tắt được là chủ ý', () => {
    render(<App />)
    const notice = screen.getByRole('note')
    expect(notice.querySelector('button')).toBeNull()
  })

  it('bấm vào ghi chú KHÔNG làm nó biến mất', () => {
    // Ba test kia chỉ kiểm lúc mount. Đã kiểm chứng: biến ghi chú thành
    // tắt-được (useState(false) + onClick) vẫn xanh cả 298 test, vì trạng
    // thái ban đầu không đổi. "Thường trực" phải được ép ở đây.
    render(<Shell {...shellProps} />)
    fireEvent.click(screen.getByRole('note'))
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  it('ghi chú không chứa nút đóng nào', () => {
    render(<Shell {...shellProps} />)
    const note = screen.getByRole('note')
    expect(within(note).queryByRole('button')).toBeNull()
  })

  it('ghi chú vẫn còn sau khi đổi lesson và tua timeline', () => {
    // Chống kiểu render có điều kiện theo state store.
    render(<Shell {...shellProps} />)
    act(() => { useLabStore.getState().loadLesson('supervisor') })
    act(() => { useLabStore.getState().setStep(5) })
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})
