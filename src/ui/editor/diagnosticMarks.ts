import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import {
  Decoration, EditorView, gutter, GutterMarker,
  type DecorationSet,
} from '@codemirror/view'
import { clampDiagnosticLine } from '../diagnostics/clampLine'

/**
 * Các dòng 1-based mang lỗi — CHƯA kẹp ở đây. Giống `setCurrentLine` (Task 9),
 * việc kẹp diễn ra bên trong `update()` bằng `tr.state.doc.lines`, tức là
 * bằng tài liệu THẬT tại đúng thời điểm effect được áp dụng. Nếu kẹp trước
 * khi dispatch (vd. bằng độ dài `source` trong store, có thể trễ hơn vài
 * kí tự so với EditorView đang gõ dở) thì số đã kẹp vẫn có thể sai lệch với
 * doc thật lúc effect chạy — đúng cái bẫy mà brief cảnh báo hai lần
 * ("trước khi hiện VÀ trước khi nhảy").
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
 * `doc.line(n)` với n ngoài [1, doc.lines] NÉM (RangeError) và làm chết cả
 * editor — hazard giống hệt Task 9 (`lineDeco`), lặp lại ở đây vì mỗi
 * diagnostic mang dòng riêng, không chỉ một dòng như current-line.
 */
function diagnosticDeco(doc: Text, lines: readonly number[]): DecorationSet {
  if (lines.length === 0) return Decoration.none
  const clamped = [...new Set(lines.map(l => clampDiagnosticLine(l, doc.lines)))].sort((a, b) => a - b)
  return Decoration.set(
    clamped.map(n => Decoration.line({ class: 'cm-diagnostic-line' }).range(doc.line(n).from)),
  )
}

/**
 * StateField giữ DecorationSet của các dòng lỗi (gạch chân). Cùng khuôn với
 * `currentLineField`: chỉ dựng lại khi có effect `setDiagnosticLines`; mọi
 * transaction khác map theo `tr.changes` để không rớt ra ngoài khi user gõ
 * trong lúc chờ debounce biên dịch lại.
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
 * Gutter chấm đỏ, đọc lại đúng những dòng mà `diagnosticsField` đang gạch
 * chân — một nguồn sự thật duy nhất cho "dòng nào có lỗi", không phải tính
 * lại độc lập (sẽ có nguy cơ trôi lệch giữa gutter và gạch chân).
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
 * Extension gộp: gạch chân dòng lỗi + gutter chấm đỏ (brief Task 10, Step 2).
 *
 * CodeEditor.tsx (Task 9) đã có sẵn `extraExtensions` cho đúng việc này — cắm
 * qua đó thay vì sửa CodeEditor.tsx, vì CodeEditor nằm trong danh sách
 * "consume, không sửa" của task này. Cập nhật dữ liệu (dispatch
 * `setDiagnosticLines`) thực hiện từ App bằng `EditorView.findFromDOM`, kỹ
 * thuật mà chính bộ test của dự án đã dùng để chạm EditorView từ bên ngoài
 * CodeEditor (xem tests/ui/code-editor.test.tsx, current-line-wiring.test.tsx)
 * — không phải một cơ chế mới, chỉ là điểm gọi `dispatch` nằm ngoài
 * CodeEditor thay vì trong một `useEffect` của chính nó.
 */
export const diagnosticMarks: Extension[] = [diagnosticsField, diagnosticGutter]
