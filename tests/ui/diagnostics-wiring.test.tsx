import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { openDebug } from './helpers/openDebug'

/**
 * "Nối dây" ngoài 7 test của brief (tests/ui/diagnostics.test.tsx), theo đúng
 * bài học ghi lại ở Task 8/9 (progress.md): test dựng DiagnosticsPanel/
 * diagnosticMarks TRỰC TIẾP không thể bắt lỗi kiểu "App quên đọc
 * compiled.diagnostics", "App quên truyền extraExtensions vào CodeEditor",
 * hay "App quên dispatch setDiagnosticLines" — hành vi đó CHỈ tồn tại khi
 * App, CodeEditor và DiagnosticsPanel được ghép lại thật. File brief không
 * liệt kê Files: Modify App.tsx cho task này, nhưng không nối dây thì
 * "markers in the editor" mà task mô tả không có thật trong app chạy được.
 */
describe('nối dây App — diagnostics chảy từ store vào cả panel lẫn editor', () => {
  it('lỗi validator thật hiện trong DiagnosticsPanel VÀ tô dấu trong CodeEditor sống', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { val c = Channel<Int>() }')
    const diag = useLabStore.getState().compiled.diagnostics[0]!
    expect(diag.hint, 'fixture phải có hint để test có ý nghĩa').toBeDefined()

    const { container } = render(<App />)

    openDebug()

    // Panel: thông điệp + hint thật từ store, không phải fixture dựng tay.
    expect(screen.getByText(diag.message)).toBeInTheDocument()
    expect(screen.getByText(diag.hint!)).toBeInTheDocument()

    // Editor: gutter chấm đỏ + gạch chân THẬT SỰ được vẽ vào DOM của
    // EditorView sống — đây là phần mà test thuần diagnosticMarks.test.ts
    // (dựng EditorState trần) không chạm tới được.
    expect(container.querySelector('.cm-diagnostic-line')).not.toBeNull()
    expect(container.querySelector('.cm-diagnostic-dot')).not.toBeNull()
  })

  it('không có lỗi thì CodeEditor sống không còn dấu nào', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { println("hi") }')
    const { container } = render(<App />)
    openDebug()
    expect(useLabStore.getState().compiled.diagnostics).toEqual([])
    expect(container.querySelector('.cm-diagnostic-line')).toBeNull()
    expect(container.querySelector('.cm-diagnostic-dot')).toBeNull()
  })

  it('bấm vào diagnostic dispatch một transaction cuộn vào EditorView sống, không ném', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { val c = Channel<Int>() }')
    const { container } = render(<App />)
    openDebug()

    const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('không tìm thấy EditorView trong DOM')
    const dispatchSpy = vi.spyOn(view, 'dispatch')

    // Scoped bằng class riêng của DiagnosticsPanel, KHÔNG screen.getByRole('button')
    // trần: giả định "App chỉ có đúng một nút" đã vỡ ở Task 17 khi
    // PlaybackControls thêm 7 nút thật (Lùi/Phát-Tạm dừng/Tiến + 4 tốc độ) vào
    // mọi render của App. Test này chỉ quan tâm nút CỦA DIAGNOSTICS PANEL.
    const button = container.querySelector<HTMLButtonElement>('.diagnostic-item__button')
    if (!button) throw new Error('không tìm thấy nút diagnostic trong DOM')
    expect(() => act(() => { button.click() })).not.toThrow()
    expect(dispatchSpy).toHaveBeenCalled()
  })
})
