import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { diagnosticsField, setDiagnosticLines } from '../../src/ui/editor/diagnosticMarks'

/**
 * `DiagnosticsPanel` (tests/ui/diagnostics.test.tsx) khoá việc kẹp dòng ở
 * TẦNG HIỂN THỊ số/gọi callback. Nhưng hazard thật của brief ("doc.line(n)
 * ngoài khoảng NÉM và làm chết cả editor") nằm ở TẦNG NÀY — `diagnosticsField`
 * gọi thẳng `doc.line(n)` trên EditorState thật của CodeMirror, thứ mà
 * DiagnosticsPanel (component thuần React, không đụng CodeMirror) không bao
 * giờ chạm tới. Không test riêng module này thì việc kẹp trong CodeEditor
 * sống có thể bị xoá mà cả bộ test vẫn xanh — giống chính xác gap mà task 9
 * cảnh báo (`current-line.test.ts`). Dựng theo cùng khuôn với file đó.
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

describe('diagnosticsField — StateField gạch chân dòng lỗi', () => {
  it('một dòng hợp lệ được gạch chân đúng dòng đó', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [3])
    expect(markedLines(s)).toEqual([3])
  })

  it('nhiều dòng hợp lệ đều được gạch chân, không trùng lặp', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [2, 4, 2])
    expect(markedLines(s)).toEqual([2, 4])
  })

  it('mảng rỗng không gạch chân dòng nào', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [])
    expect(markedLines(s)).toEqual([])
  })

  it('dòng 0 (dưới 1) được kẹp về dòng 1, không ném', () => {
    expect(() => dispatchLines(stateWithDoc(DOC5), [0])).not.toThrow()
    expect(markedLines(dispatchLines(stateWithDoc(DOC5), [0]))).toEqual([1])
  })

  it('dòng 9999 (vượt quá doc.lines) được kẹp về dòng cuối, không ném — hazard chính của brief', () => {
    expect(() => dispatchLines(stateWithDoc(DOC5), [9999])).not.toThrow()
    expect(markedLines(dispatchLines(stateWithDoc(DOC5), [9999]))).toEqual([5])
  })

  it('đổi từ [3] sang [1] thì dòng 3 hết được gạch chân', () => {
    let s = dispatchLines(stateWithDoc(DOC5), [3])
    expect(markedLines(s)).toEqual([3])
    s = dispatchLines(s, [1])
    expect(markedLines(s)).toEqual([1])
  })

  it('decoration mang đúng class cm-diagnostic-line', () => {
    const s = dispatchLines(stateWithDoc(DOC5), [2])
    const deco = s.field(diagnosticsField)
    let sawClass = false
    deco.between(0, s.doc.length, (_from, _to, value) => {
      const spec = (value as Decoration).spec as { class?: string }
      if (spec.class === 'cm-diagnostic-line') sawClass = true
    })
    expect(sawClass).toBe(true)
  })

  it('user gõ (docChanged) mà không kèm effect mới thì deco được map theo thay đổi, không ném', () => {
    let s = dispatchLines(stateWithDoc(DOC5), [3])
    s = s.update({ changes: { from: 0, insert: 'X' } }).state
    expect(markedLines(s)).toEqual([3])
  })

  it('user xoá sạch doc trong lúc đang gạch chân thì deco map an toàn, không ném', () => {
    let s = dispatchLines(stateWithDoc(DOC5), [3])
    expect(() => {
      s = s.update({ changes: { from: 0, to: s.doc.length, insert: '' } }).state
    }).not.toThrow()
  })
})
