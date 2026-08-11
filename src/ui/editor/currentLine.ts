import { StateEffect, StateField, type Text } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** Dòng 1-based đang chạy, hoặc null nếu chưa có dòng nào để tô. */
export const setCurrentLine = StateEffect.define<number | null>()

/**
 * `srcLine` là 1-based (Pos của AST) còn `doc.line()` cũng 1-based — khớp.
 * Nhưng PHẢI kẹp: tồn đọng M1 khiến diagnostic bên trong "${...}" báo dòng 1,
 * và source có thể ngắn hơn trace nếu user vừa xoá vài dòng mà chưa compile lại.
 * `doc.line(n)` với n ngoài khoảng sẽ NÉM và làm chết cả editor.
 */
function lineDeco(doc: Text, line: number | null): DecorationSet {
  if (line === null || line < 1 || line > doc.lines) return Decoration.none
  const l = doc.line(line)
  return Decoration.set([Decoration.line({ class: 'cm-current-line' }).range(l.from)])
}

/**
 * StateField giữ đúng một DecorationSet. Chỉ dựng lại khi có effect
 * `setCurrentLine` — với mọi transaction khác (vd. user gõ), map decoration
 * cũ qua tr.changes: RangeSet.map không bao giờ ném, kể cả khi dòng đang tô
 * bị xoá mất trong lúc chờ debounce biên dịch lại (xem CodeEditor.tsx).
 */
export const currentLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setCurrentLine)) return lineDeco(tr.state.doc, e.value)
    }
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: field => EditorView.decorations.from(field),
})
