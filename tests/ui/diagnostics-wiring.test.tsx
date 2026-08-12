import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'

/**
 * "Wiring" beyond the brief's 7 tests (tests/ui/diagnostics.test.tsx), per the
 * lesson recorded in Task 8/9 (progress.md): tests that render
 * DiagnosticsPanel/diagnosticMarks DIRECTLY can't catch bugs like "App forgot
 * to read compiled.diagnostics", "App forgot to pass extraExtensions to
 * CodeEditor", or "App forgot to dispatch setDiagnosticLines" — that behavior
 * ONLY exists once App, CodeEditor and DiagnosticsPanel are actually wired
 * together. The brief's file list doesn't mention Modify App.tsx for this
 * task, but without wiring it up, the "markers in the editor" the task
 * describes don't actually exist in the running app.
 */
describe('App wiring — diagnostics flow from the store into both the panel and the editor', () => {
  it('a real validator error shows in DiagnosticsPanel AND marks the live CodeEditor', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { val c = Channel<Int>() }')
    const diag = useLabStore.getState().compiled.diagnostics[0]!
    expect(diag.hint, 'fixture must have a hint for this test to mean anything').toBeDefined()

    const { container } = render(<App />)


    // The error must be readable IMMEDIATELY, with the debug panel still
    // CLOSED (the default). This is exactly what used to be broken: learners
    // only saw a red-underlined line in the editor, with the explanation
    // hidden behind a button they didn't know they had to click.
    expect(screen.queryByRole('button', { name: 'Close debug panel' }),
      'the debug panel must be CLOSED for this test to mean anything').toBeNull()
    expect(screen.getByText(diag.message)).toBeInTheDocument()
    expect(screen.getByText(diag.hint!)).toBeInTheDocument()

    // And it sits in the CODE COLUMN, next to the code — not in the column on
    // the other side of the screen.
    const codeCol = container.querySelector('.editor-col')!
    expect(codeCol.textContent, 'the error is not inside the code column').toContain(diag.message)

    // Editor: the red-dot gutter + underline are ACTUALLY drawn into the live
    // EditorView's DOM — this is the part that the pure diagnosticMarks.test.ts
    // (building a bare EditorState) can't reach.
    expect(container.querySelector('.cm-diagnostic-line')).not.toBeNull()
    expect(container.querySelector('.cm-diagnostic-dot')).not.toBeNull()
  })

  it('clean code means NO error box takes up space below the editor', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { println("hi") }')
    render(<App />)
    expect(screen.queryByRole('region', { name: /error\(s\) to fix/ })).toBeNull()
  })

  it('no errors means the live CodeEditor has no marks left', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { println("hi") }')
    const { container } = render(<App />)
    expect(useLabStore.getState().compiled.diagnostics).toEqual([])
    expect(container.querySelector('.cm-diagnostic-line')).toBeNull()
    expect(container.querySelector('.cm-diagnostic-dot')).toBeNull()
  })

  it('clicking a diagnostic dispatches a scroll transaction into the live EditorView, does not throw', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking { val c = Channel<Int>() }')
    const { container } = render(<App />)

    const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('could not find EditorView in the DOM')
    const dispatchSpy = vi.spyOn(view, 'dispatch')

    // Scoped by DiagnosticsPanel's own class, NOT a bare
    // screen.getByRole('button'): the assumption "App has exactly one
    // button" broke in Task 17 when PlaybackControls added 7 real buttons
    // (Back/Play-Pause/Forward + 4 speeds) to every render of App. This test
    // only cares about the DIAGNOSTICS PANEL's button.
    const button = container.querySelector<HTMLButtonElement>('.diagnostic-item__button')
    if (!button) throw new Error('could not find the diagnostic button in the DOM')
    expect(() => act(() => { button.click() })).not.toThrow()
    expect(dispatchSpy).toHaveBeenCalled()
  })
})
