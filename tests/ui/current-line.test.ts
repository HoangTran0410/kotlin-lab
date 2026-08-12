import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { currentLineField, setCurrentLine } from '../../src/ui/editor/currentLine'
import { highlightedLine } from './support/highlightedLine'

function stateWithDoc(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [currentLineField] })
}

function dispatchLine(state: EditorState, line: number | null): EditorState {
  return state.update({ effects: setCurrentLine.of(line) }).state
}

const DOC5 = 'line1\nline2\nline3\nline4\nline5'

// Pure test, no React rendering needed (brief task 9 step 2). Builds a bare
// EditorState, dispatches an effect, reads the decoration back via
// highlightedLine().
describe('currentLineField — StateField highlighting the running line', () => {
  it('srcLine = 3 highlights exactly line 3', () => {
    const s = dispatchLine(stateWithDoc(DOC5), 3)
    expect(highlightedLine(s)).toBe(3)
  })

  it('srcLine = null highlights nothing', () => {
    const s = dispatchLine(stateWithDoc(DOC5), null)
    expect(highlightedLine(s)).toBeNull()
  })

  it("srcLine = 0 highlights nothing, doesn't throw", () => {
    expect(() => dispatchLine(stateWithDoc(DOC5), 0)).not.toThrow()
    const s = dispatchLine(stateWithDoc(DOC5), 0)
    expect(highlightedLine(s)).toBeNull()
  })

  it("srcLine = 9999 (past the line count) highlights nothing, doesn't throw", () => {
    expect(() => dispatchLine(stateWithDoc(DOC5), 9999)).not.toThrow()
    const s = dispatchLine(stateWithDoc(DOC5), 9999)
    expect(highlightedLine(s)).toBeNull()
  })

  it("srcLine = 1 on an empty doc doesn't throw", () => {
    expect(() => dispatchLine(stateWithDoc(''), 1)).not.toThrow()
    // An empty doc still has exactly 1 logical line (line 1, empty content) —
    // CodeMirror treats this as valid, not "past the line count".
    const s = dispatchLine(stateWithDoc(''), 1)
    expect(highlightedLine(s)).toBe(1)
  })

  it('switching from line 3 to line 5 un-highlights line 3', () => {
    let s = dispatchLine(stateWithDoc(DOC5), 3)
    expect(highlightedLine(s)).toBe(3)
    s = dispatchLine(s, 5)
    expect(highlightedLine(s)).toBe(5)
  })

  // The three tests below go beyond the brief's minimum of 6 — added to lock
  // down the actual CSS class used for styling, and to lock down the
  // "docChanged without a new effect" behavior, which the brief doesn't list
  // as a separate case but which both the sample code (the implicit
  // deco.map) and hazard B2 in the prompt depend on.

  it('decoration carries the correct cm-current-line class', () => {
    const s = dispatchLine(stateWithDoc(DOC5), 2)
    const deco = s.field(currentLineField)
    let sawClass = false
    deco.between(0, s.doc.length, (_from, _to, value) => {
      const spec = (value as Decoration).spec as { class?: string }
      if (spec.class === 'cm-current-line') sawClass = true
    })
    expect(sawClass).toBe(true)
  })

  it("user typing (docChanged) without a new effect doesn't throw, decoration is mapped through the change", () => {
    let s = dispatchLine(stateWithDoc(DOC5), 3)
    // Insert one character at the start of the doc — line 3 is still there, just shifted.
    s = s.update({ changes: { from: 0, insert: 'X' } }).state
    expect(highlightedLine(s)).toBe(3)
  })

  it("user clearing the whole doc while it's highlighted maps the decoration safely, doesn't throw", () => {
    let s = dispatchLine(stateWithDoc(DOC5), 3)
    expect(() => {
      s = s.update({ changes: { from: 0, to: s.doc.length, insert: '' } }).state
    }).not.toThrow()
  })
})
