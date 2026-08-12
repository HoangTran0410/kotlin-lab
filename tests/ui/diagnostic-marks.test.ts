import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { diagnosticsField, setDiagnosticLines } from '../../src/ui/editor/diagnosticMarks'

/**
 * `DiagnosticsPanel` (tests/ui/diagnostics.test.tsx) locks down clamping at
 * the DISPLAY LAYER — the number shown / the callback invoked. But the
 * brief's real hazard ("doc.line(n) out of range THROWS and kills the whole
 * editor") lives at THIS LAYER — `diagnosticsField` calls `doc.line(n)`
 * directly on CodeMirror's real EditorState, something DiagnosticsPanel (a
 * pure React component that never touches CodeMirror) never reaches. Without
 * a test dedicated to this module, the clamping inside the live CodeEditor
 * could be deleted and the whole test suite would still stay green — exactly
 * the gap task 9 warned about (`current-line.test.ts`). Built to the same
 * shape as that file.
 */
function stateWithDoc(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [diagnosticsField] })
}

function dispatchLines(state: EditorState, lines: readonly number[]): EditorState {
  return state.update({ effects: setDiagnosticLines.of(lines) }).state
}

function markedLines(state: EditorState): number[] {
  const deco = state.field(diagnosticsField)
  const froms: number[] = []
  deco.between(0, state.doc.length, from => { froms.push(from) })
  return froms.map(from => state.doc.lineAt(from).number)
}

const DOC5 = 'line1\nline2\nline3\nline4\nline5'

describe('diagnosticsField — StateField underlining error lines', () => {
  it('one valid line gets underlined, exactly that line', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [3])
    expect(markedLines(s)).toEqual([3])
  })

  it('multiple valid lines all get underlined, no duplicates', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [2, 4, 2])
    expect(markedLines(s)).toEqual([2, 4])
  })

  it('an empty array underlines no lines', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [])
    expect(markedLines(s)).toEqual([])
  })

  it('line 0 (below 1) is clamped to line 1, does not throw', () => {
    expect(() => dispatchLines(stateWithDoc(DOC5), [0])).not.toThrow()
    expect(markedLines(dispatchLines(stateWithDoc(DOC5), [0]))).toEqual([1])
  })

  it('line 9999 (past doc.lines) is clamped to the last line, does not throw — the brief\'s main hazard', () => {
    expect(() => dispatchLines(stateWithDoc(DOC5), [9999])).not.toThrow()
    expect(markedLines(dispatchLines(stateWithDoc(DOC5), [9999]))).toEqual([5])
  })

  it('switching from [3] to [1] removes the underline from line 3', () => {
    let s = dispatchLines(stateWithDoc(DOC5), [3])
    expect(markedLines(s)).toEqual([3])
    s = dispatchLines(s, [1])
    expect(markedLines(s)).toEqual([1])
  })

  it('the decoration carries the correct cm-diagnostic-line class', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [2])
    const deco = s.field(diagnosticsField)
    let sawClass = false
    deco.between(0, s.doc.length, (_from, _to, value) => {
      const spec = (value as Decoration).spec as { class?: string }
      if (spec.class === 'cm-diagnostic-line') sawClass = true
    })
    expect(sawClass).toBe(true)
  })

  it('the user typing (docChanged) with no new effect maps the deco through the change, does not throw', () => {
    let s = dispatchLines(stateWithDoc(DOC5), [3])
    s = s.update({ changes: { from: 0, insert: 'X' } }).state
    expect(markedLines(s)).toEqual([3])
  })

  it('the user wiping the doc while a line is underlined maps the deco safely, does not throw', () => {
    let s = dispatchLines(stateWithDoc(DOC5), [3])
    expect(() => {
      s = s.update({ changes: { from: 0, to: s.doc.length, insert: '' } }).state
    }).not.toThrow()
  })
})
