import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'

/**
 * Breakpoint lines currently set, 1-based. Dispatched from App whenever the
 * store's list changes — the store stays the single source of truth and the
 * editor only mirrors it, so the gutter can never disagree with what the
 * "run to breakpoint" button will actually do.
 */
export const setBreakpointLines = StateEffect.define<readonly number[]>()

/**
 * Lines that ANY event in the trace touches.
 *
 * Used to dim a breakpoint on a line that never runs. Without it, setting a
 * breakpoint on a comment, a blank line, or a branch that is never taken looks
 * exactly like setting a working one, and "I pressed run and nothing happened"
 * reads as a broken tool rather than as the real answer: that line never
 * executes. Making that visible turns a dead end into a finding.
 */
export const setReachableLines = StateEffect.define<readonly number[]>()

interface State {
  breakpoints: ReadonlySet<number>
  reachable: ReadonlySet<number>
}

const EMPTY: State = { breakpoints: new Set(), reachable: new Set() }

export const breakpointState = StateField.define<State>({
  create: () => EMPTY,
  update(value, tr) {
    let next = value
    for (const e of tr.effects) {
      if (e.is(setBreakpointLines)) next = { ...next, breakpoints: new Set(e.value) }
      if (e.is(setReachableLines)) next = { ...next, reachable: new Set(e.value) }
    }
    return next
  },
})

class BreakpointMarker extends GutterMarker {
  constructor(private readonly reachable: boolean) { super() }
  eq(other: GutterMarker): boolean {
    return other instanceof BreakpointMarker && other.reachable === this.reachable
  }
  toDOM(): Node {
    const dot = document.createElement('span')
    dot.className = this.reachable ? 'cm-bp-dot' : 'cm-bp-dot cm-bp-dot--unreachable'
    dot.title = this.reachable
      ? 'Breakpoint — click to remove'
      : 'Breakpoint on a line this program never reaches'
    return dot
  }
}
const liveMarker = new BreakpointMarker(true)
const deadMarker = new BreakpointMarker(false)

/**
 * A clickable gutter for setting breakpoints, plus the dot that shows them.
 *
 * A FACTORY, not a constant like `diagnosticMarks`: the click has to reach
 * React state, and CodeMirror extensions are built once at editor mount. The
 * callback passed in must therefore be stable — App passes the Zustand action,
 * which is.
 *
 * The click only reports the line; it does NOT update the field itself. Data
 * flows one way (store -> `setBreakpointLines` -> gutter), so there is no
 * second copy of the truth to drift.
 */
export function breakpointGutter(onToggle: (line: number) => void): Extension[] {
  return [
    breakpointState,
    gutter({
      class: 'cm-bp-gutter',
      lineMarker(view, line) {
        const { breakpoints, reachable } = view.state.field(breakpointState)
        const n = view.state.doc.lineAt(line.from).number
        if (!breakpoints.has(n)) return null
        // No reachability data yet (the program hasn't compiled) counts as
        // reachable: claiming "this line never runs" before there is a trace
        // to say so would be a guess presented as a fact.
        return reachable.size === 0 || reachable.has(n) ? liveMarker : deadMarker
      },
      lineMarkerChange: u => u.state.field(breakpointState) !== u.startState.field(breakpointState),
      // No `initialSpacer`. It renders a hidden marker of the SAME class to
      // reserve width, which makes "count the dots" — the obvious way to check
      // this from the outside, and what the tests do — report one dot too many
      // forever. The gutter has an explicit width in the theme below, so the
      // spacer bought nothing.
      domEventHandlers: {
        mousedown(view, line) {
          onToggle(view.state.doc.lineAt(line.from).number)
          // Consume it: without this, the click also moves the cursor into the
          // gutter's line, which drags the editor's scroll position around
          // while someone is just placing breakpoints.
          return true
        },
      },
    }),
    EditorView.baseTheme({
      '.cm-bp-gutter': { width: '14px', cursor: 'pointer' },
    }),
  ]
}
