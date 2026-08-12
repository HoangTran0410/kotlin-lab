import { expect } from 'vitest'
import type { EditorState } from '@codemirror/state'
import { currentLineField } from '../../../src/ui/editor/currentLine'

/**
 * Reads back the 1-based line currently highlighted in currentLineField, or
 * null if the decoration set is empty. Throws if more than one line is
 * highlighted (which should never happen — currentLineField only ever holds
 * exactly one Decoration.line, or none).
 *
 * This helper does NOT live in current-line.test.ts: importing a *.test.ts
 * file from another *.test.tsx file re-runs every describe/it in the imported
 * file (module-scope side effects), doubling the number of registered tests —
 * measured while trying it (9 pure tests + 2 wiring tests were counted as 11
 * in the wiring file).
 */
export function highlightedLine(state: EditorState): number | null {
  const deco = state.field(currentLineField)
  const froms: number[] = []
  deco.between(0, state.doc.length, from => { froms.push(from) })
  if (froms.length === 0) return null
  expect(froms.length, 'exactly one line must be highlighted').toBe(1)
  return state.doc.lineAt(froms[0]!).number
}
