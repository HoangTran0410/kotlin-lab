import { StateEffect, StateField, type Text } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** 1-based line currently running, or null if there's no line to highlight yet. */
export const setCurrentLine = StateEffect.define<number | null>()

/**
 * `srcLine` is 1-based (AST Pos) and `doc.line()` is also 1-based — they
 * match. But it MUST be clamped: leftover item M1 makes a diagnostic inside
 * "${...}" report line 1, and the source can be shorter than the trace if the
 * user just deleted a few lines and hasn't recompiled yet. `doc.line(n)` with
 * n out of range THROWS and kills the whole editor.
 */
function lineDeco(doc: Text, line: number | null): DecorationSet {
  if (line === null || line < 1 || line > doc.lines) return Decoration.none
  const l = doc.line(line)
  return Decoration.set([Decoration.line({ class: 'cm-current-line' }).range(l.from)])
}

/**
 * StateField holding exactly one DecorationSet. Only rebuilt when there's a
 * `setCurrentLine` effect — for every other transaction (e.g. the user
 * typing), it maps the old decoration through tr.changes: RangeSet.map never
 * throws, even when the highlighted line gets deleted while a recompile
 * debounce is still pending (see CodeEditor.tsx).
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
