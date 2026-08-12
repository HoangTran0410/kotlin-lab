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

// Test thuần, không cần render React (brief task 9 step 2). Dựng EditorState
// trần, dispatch effect, đọc decoration ra qua highlightedLine().
describe('currentLineField — StateField tô dòng đang chạy', () => {
  it('srcLine = 3 tô đúng dòng 3', () => {
    const s = dispatchLine(stateWithDoc(DOC5), 3)
    expect(highlightedLine(s)).toBe(3)
  })

  it('srcLine = null không tô gì', () => {
    const s = dispatchLine(stateWithDoc(DOC5), null)
    expect(highlightedLine(s)).toBeNull()
  })

  it('srcLine = 0 không tô, không ném', () => {
    expect(() => dispatchLine(stateWithDoc(DOC5), 0)).not.toThrow()
    const s = dispatchLine(stateWithDoc(DOC5), 0)
    expect(highlightedLine(s)).toBeNull()
  })

  it('srcLine = 9999 (quá số dòng) không tô, không ném', () => {
    expect(() => dispatchLine(stateWithDoc(DOC5), 9999)).not.toThrow()
    const s = dispatchLine(stateWithDoc(DOC5), 9999)
    expect(highlightedLine(s)).toBeNull()
  })

  it('srcLine = 1 trên doc rỗng không ném', () => {
    expect(() => dispatchLine(stateWithDoc(''), 1)).not.toThrow()
    // Doc rỗng vẫn có đúng 1 dòng logic (dòng 1, nội dung rỗng) — CodeMirror
    // coi đây là hợp lệ, không phải "quá số dòng".
    const s = dispatchLine(stateWithDoc(''), 1)
    expect(highlightedLine(s)).toBe(1)
  })

  it('đổi từ dòng 3 sang dòng 5 thì dòng 3 hết tô', () => {
    let s = dispatchLine(stateWithDoc(DOC5), 3)
    expect(highlightedLine(s)).toBe(3)
    s = dispatchLine(s, 5)
    expect(highlightedLine(s)).toBe(5)
  })

  // Ba test dưới vượt 6 yêu cầu tối thiểu của brief — thêm để khoá đúng
  // class CSS thật dùng để style, và khoá hành vi "docChanged không kèm
  // effect mới" mà brief không liệt kê case riêng nhưng đoạn code mẫu
  // (deco.map ngầm định) và hazard B2 trong prompt đều phụ thuộc vào.

  it('decoration mang đúng class cm-current-line', () => {
    const s = dispatchLine(stateWithDoc(DOC5), 2)
    const deco = s.field(currentLineField)
    let sawClass = false
    deco.between(0, s.doc.length, (_from, _to, value) => {
      const spec = (value as Decoration).spec as { class?: string }
      if (spec.class === 'cm-current-line') sawClass = true
    })
    expect(sawClass).toBe(true)
  })

  it('user gõ (docChanged) mà không kèm effect mới thì không ném, deco được map theo thay đổi', () => {
    let s = dispatchLine(stateWithDoc(DOC5), 3)
    // Chèn một ký tự vào đầu doc — dòng 3 vẫn còn, chỉ dịch offset.
    s = s.update({ changes: { from: 0, insert: 'X' } }).state
    expect(highlightedLine(s)).toBe(3)
  })

  it('user xoá sạch doc trong lúc đang tô thì deco map an toàn, không ném', () => {
    let s = dispatchLine(stateWithDoc(DOC5), 3)
    expect(() => {
      s = s.update({ changes: { from: 0, to: s.doc.length, insert: '' } }).state
    }).not.toThrow()
  })
})
