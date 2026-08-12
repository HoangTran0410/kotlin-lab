import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'

/**
 * "Nối dây" theo đúng bài học Task 8/9/10/16/17: test dựng ConsolePanel TRỰC
 * TIẾP (console.test.tsx) không thể bắt lỗi kiểu "App quên mount
 * ConsolePanel", "App truyền `stepIndex` sai" (vd hardcode
 * compiled.events.length thay vì đọc store thật, khiến console luôn hiện
 * TOÀN BỘ trace bất kể đang tua ở đâu — đúng loại lỗi mà red-check #1 của
 * task này nhắm tới). Chỉ ở đây, với <App/> ghép thật và store thật, mới lộ
 * ra loại lỗi đó.
 */
describe('nối dây App -> ConsolePanel — console thật đi theo stepIndex thật của store', () => {
  it('scrub qua store thật làm console thật đổi theo, đúng trạng thái rỗng ban đầu và đầy đủ ở step cuối', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)

    const region = screen.getByRole('region', { name: 'Console & chẩn đoán' })
    expect(within(region).getByText('Chưa có output.')).toBeInTheDocument()

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture supervisor cần đủ event để test có ý nghĩa').toBeGreaterThan(0)

    act(() => { useLabStore.getState().setStep(total) })
    expect(within(region).getByText('A xong')).toBeInTheDocument()
    expect(within(region).getByText('C xong')).toBeInTheDocument()

    // Tua ngược qua store thật (không phải rerender prop tay) — dòng phải
    // biến mất, đây chính là bất biến trung tâm mà red-check #1 kiểm.
    act(() => { useLabStore.getState().setStep(0) })
    expect(within(region).getByText('Chưa có output.')).toBeInTheDocument()
    expect(within(region).queryByText('A xong')).not.toBeInTheDocument()
  })
})
