import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import {
  Decoration, EditorView, gutter, GutterMarker,
  type DecorationSet,
} from '@codemirror/view'
import { clampDiagnosticLine } from '../diagnostics/clampLine'

/**
 * 1-based lines carrying an error — NOT clamped here yet. Like
 * `setCurrentLine` (Task 9), the clamping happens inside `update()` using
 * `tr.state.doc.lines`, i.e. against the REAL document at the exact moment
 * the effect is applied. If clamped before dispatch instead (e.g. against the
 * store's `source` length, which can lag a few characters behind the
 * EditorView the user is mid-typing in), the clamped number can still drift
 * from the real doc by the time the effect runs — exactly the trap the brief
 * warns about twice ("before showing it AND before jumping to it").
 */
export const setDiagnosticLines = StateEffect.define<readonly number[]>()

class DiagnosticDotMarker extends GutterMarker {
  eq(other: GutterMarker): boolean {
    return other instanceof DiagnosticDotMarker
  }
  toDOM(): Node {
    const dot = document.createElement('span')
    dot.className = 'cm-diagnostic-dot'
    dot.setAttribute('aria-hidden', 'true')
    return dot
  }
}
const dotMarker = new DiagnosticDotMarker()

/**
 * `doc.line(n)` with n outside [1, doc.lines] THROWS (RangeError) and kills
 * the whole editor — the exact same hazard as Task 9 (`lineDeco`), repeated
 * here because each diagnostic carries its own line, not just one line like
 * current-line.
 */
function diagnosticDeco(doc: Text, lines: readonly number[]): DecorationSet {
  if (lines.length === 0) return Decoration.none
  const clamped = [...new Set(lines.map(l => clampDiagnosticLine(l, doc.lines)))].sort((a, b) => a - b)
  return Decoration.set(
    clamped.map(n => Decoration.line({ class: 'cm-diagnostic-line' }).range(doc.line(n).from)),
  )
}

/**
 * StateField holding the DecorationSet for error lines (underline). Same
 * shape as `currentLineField`: only rebuilt when there's a
 * `setDiagnosticLines` effect; every other transaction maps through
 * `tr.changes` so it doesn't fall out of sync when the user types while a
 * recompile debounce is still pending.
 */
export const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagnosticLines)) return diagnosticDeco(tr.state.doc, e.value)
    }
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: field => EditorView.decorations.from(field),
})

/**
 * The red-dot gutter, reading back exactly the lines that `diagnosticsField`
 * is underlining — one single source of truth for "which line has an
 * error", instead of computing it independently (which would risk the
 * gutter and the underline drifting apart).
 */
const diagnosticGutter = gutter({
  class: 'cm-diagnostic-gutter',
  lineMarker(view, line) {
    let hit = false
    view.state.field(diagnosticsField).between(line.from, line.from, () => { hit = true })
    return hit ? dotMarker : null
  },
  lineMarkerChange: update => update.state.field(diagnosticsField) !== update.startState.field(diagnosticsField),
})

/**
 * Combined extension: error-line underline + red-dot gutter (brief Task 10,
 * Step 2).
 *
 * CodeEditor.tsx (Task 9) already has `extraExtensions` set up for exactly
 * this — plugged in through that instead of editing CodeEditor.tsx, since
 * CodeEditor is on this task's "consume, don't modify" list. The data update
 * (dispatching `setDiagnosticLines`) happens from App using
 * `EditorView.findFromDOM`, the technique the project's own test suite
 * already uses to reach the EditorView from outside CodeEditor (see
 * tests/ui/code-editor.test.tsx, current-line-wiring.test.tsx) — not a new
 * mechanism, just the `dispatch` call site living outside CodeEditor instead
 * of in one of its own `useEffect`s.
 */
export const diagnosticMarks: Extension[] = [diagnosticsField, diagnosticGutter]
