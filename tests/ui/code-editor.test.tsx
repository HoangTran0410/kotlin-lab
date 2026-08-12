import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { CodeEditor } from '../../src/ui/editor/CodeEditor'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'

// CodeMirror 6 captures real DOM events itself (beforeinput + MutationObserver)
// to infer changes; jsdom can't reliably simulate that flow. The standard way
// to "type" in a test is to grab the EditorView straight from the DOM (the
// public EditorView.findFromDOM API) and dispatch a transaction — the same
// path a real keyboard also takes after the input-capture step.
function viewOf(container: HTMLElement): EditorView {
  const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
  const view = EditorView.findFromDOM(host)
  if (!view) throw new Error('could not find EditorView in the DOM')
  return view
}

describe('CodeEditor — CodeMirror 6 with Kotlin syntax', () => {
  it('mounts a .cm-editor', () => {
    render(<CodeEditor value="" onChange={() => {}} />)
    expect(document.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('shows the correct initial value content', () => {
    const src = 'fun main() = runBlocking {\n  println("hi")\n}'
    render(<CodeEditor value={src} onChange={() => {}} />)
    expect(document.querySelector('.cm-content')).toHaveTextContent('fun main() = runBlocking {')
    expect(document.querySelector('.cm-content')?.textContent).toContain('println("hi")')
  })

  it('typing calls onChange with the new text', () => {
    const onChange = vi.fn()
    const { container } = render(<CodeEditor value="fun main() {}" onChange={onChange} />)
    const view = viewOf(container)
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    expect(onChange).toHaveBeenCalledWith('funX main() {}')
  })

  it('changing the value prop from outside changes the doc to match', () => {
    const { container, rerender } = render(<CodeEditor value="a" onChange={() => {}} />)
    rerender(<CodeEditor value="fun main() = runBlocking { }" onChange={() => {}} />)
    const view = viewOf(container)
    expect(view.state.doc.toString()).toBe('fun main() = runBlocking { }')
  })

  it('changing the value prop to the value it ALREADY has does NOT dispatch (no infinite loop)', () => {
    const onChange = vi.fn()
    const same = 'fun main() = runBlocking { }'
    const { rerender } = render(<CodeEditor value={same} onChange={onChange} />)
    rerender(<CodeEditor value={same} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledTimes(0)
  })

  it('typing continuously only compiles ONCE after it stops — debounce', () => {
    vi.useFakeTimers()
    try {
      const setSource = vi.spyOn(useLabStore.getState(), 'setSource')
      const { container } = render(<App />)
      // Same "typing" mechanism as the 5 CodeEditor tests above: grab the
      // real EditorView through the DOM and dispatch a transaction, instead
      // of simulating a raw input event that jsdom doesn't handle reliably
      // for CodeMirror 6's contenteditable.
      const view = viewOf(container)

      for (const ch of ['a', 'b', 'c', 'd', 'e']) {
        view.dispatch({ changes: { from: view.state.doc.length, insert: ch } })
      }

      act(() => { vi.advanceTimersByTime(100) })
      expect(setSource, 'not yet 250ms, so it should not have compiled').not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(200) })
      expect(setSource, '5 keystrokes must collapse into EXACTLY 1 compile').toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
