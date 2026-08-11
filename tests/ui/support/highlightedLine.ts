import { expect } from 'vitest'
import type { EditorState } from '@codemirror/state'
import { currentLineField } from '../../../src/ui/editor/currentLine'

/**
 * Đọc lại dòng 1-based đang được tô trong currentLineField, hoặc null nếu
 * decoration rỗng. Ném nếu có nhiều hơn một dòng được tô (không nên xảy ra —
 * currentLineField chỉ bao giờ giữ đúng một Decoration.line hoặc none).
 *
 * KHÔNG đặt hàm này trong current-line.test.ts: import một file *.test.ts từ
 * file *.test.tsx khác sẽ chạy lại toàn bộ describe/it của file bị import
 * (side effect ở module scope), nhân đôi số test đăng ký — đã đo thấy khi thử
 * (9 test thuần + 2 test nối dây bị đếm thành 11 trong file wiring).
 */
export function highlightedLine(state: EditorState): number | null {
  const deco = state.field(currentLineField)
  const froms: number[] = []
  deco.between(0, state.doc.length, from => { froms.push(from) })
  if (froms.length === 0) return null
  expect(froms.length, 'chỉ được tô đúng một dòng').toBe(1)
  return state.doc.lineAt(froms[0]!).number
}
