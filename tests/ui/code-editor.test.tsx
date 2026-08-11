import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { CodeEditor } from '../../src/ui/editor/CodeEditor'

// CodeMirror 6 tự bắt sự kiện DOM thật (beforeinput + MutationObserver) để
// suy ra thay đổi; jsdom không mô phỏng được luồng đó một cách đáng tin cậy.
// Cách chuẩn để "gõ" trong test là lấy thẳng EditorView qua DOM (API công khai
// EditorView.findFromDOM) rồi dispatch transaction — đúng con đường mà bàn
// phím thật cũng đi qua sau bước bắt input.
function viewOf(container: HTMLElement): EditorView {
  const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
  const view = EditorView.findFromDOM(host)
  if (!view) throw new Error('không tìm thấy EditorView trong DOM')
  return view
}

describe('CodeEditor — CodeMirror 6 với cú pháp Kotlin', () => {
  it('mount ra một .cm-editor', () => {
    render(<CodeEditor value="" onChange={() => {}} />)
    expect(document.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('hiện đúng nội dung value ban đầu', () => {
    const src = 'fun main() = runBlocking {\n  println("hi")\n}'
    render(<CodeEditor value={src} onChange={() => {}} />)
    expect(document.querySelector('.cm-content')).toHaveTextContent('fun main() = runBlocking {')
    expect(document.querySelector('.cm-content')?.textContent).toContain('println("hi")')
  })

  it('gõ vào gọi onChange với text mới', () => {
    const onChange = vi.fn()
    const { container } = render(<CodeEditor value="fun main() {}" onChange={onChange} />)
    const view = viewOf(container)
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    expect(onChange).toHaveBeenCalledWith('funX main() {}')
  })

  it('đổi prop value từ ngoài thì doc đổi theo', () => {
    const { container, rerender } = render(<CodeEditor value="a" onChange={() => {}} />)
    rerender(<CodeEditor value="fun main() = runBlocking { }" onChange={() => {}} />)
    const view = viewOf(container)
    expect(view.state.doc.toString()).toBe('fun main() = runBlocking { }')
  })

  it('đổi prop value thành ĐÚNG giá trị đang có thì KHÔNG dispatch (không vòng lặp)', () => {
    const onChange = vi.fn()
    const same = 'fun main() = runBlocking { }'
    const { rerender } = render(<CodeEditor value={same} onChange={onChange} />)
    rerender(<CodeEditor value={same} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledTimes(0)
  })
})
