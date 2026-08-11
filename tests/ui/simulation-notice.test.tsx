import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'

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
})
