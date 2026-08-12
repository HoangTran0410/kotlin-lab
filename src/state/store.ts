import { create } from 'zustand'
import { compile, EMPTY_COMPILED, type Compiled } from './compile'
import { lessonSource, LESSON_LIST } from '../lessons/registry'

interface LabState {
  source: string
  compiled: Compiled
  stepIndex: number
  lessonId: string | null
  /** One source snapshot retained for a direct restore after loading something else. */
  previousSource: string | null
  previousLessonId: string | null
  canRestoreSource: boolean
  /** Changes only when an external source load must start a fresh editor undo history. */
  sourceLoadRevision: number
  /**
   * 1-based lines carrying a breakpoint. Sorted, no duplicates.
   *
   * Lives in the store rather than inside the editor so that the gutter and
   * the "run to breakpoint" button read the SAME list — two copies would
   * eventually disagree about where the tool is going to stop.
   */
  breakpoints: number[]

  setSource: (src: string) => void
  setStep: (n: number) => void
  loadLesson: (id: string) => void
  /** Loads a piece of code that belongs to NO lesson (blank page, an example from the about page). */
  loadSource: (src: string) => void
  restoreSource: () => void
  toggleBreakpoint: (line: number) => void
  clearBreakpoints: () => void
}

const clampStep = (n: number, len: number): number => Math.max(0, Math.min(n, len))

/**
 * The store holds EXACTLY THREE things that can't be derived: source (what
 * the user typed), compiled (the result of a pure function over source, kept
 * here because compiling is debounced rather than done in render), stepIndex
 * (the user's cursor).
 *
 * WorldState, a node list, console lines, or a highlight line must NOT be
 * added here. They're all pure functions of the three fields above; keeping a
 * copy would mean building a state model that runs parallel to the trace —
 * something that's guaranteed to drift when scrubbing backwards.
 */
export const useLabStore = create<LabState>((set, get) => ({
  source: '',
  compiled: EMPTY_COMPILED,
  stepIndex: 0,
  lessonId: null,
  previousSource: null,
  previousLessonId: null,
  canRestoreSource: false,
  sourceLoadRevision: 0,
  breakpoints: [],

  setSource: src => {
    const compiled = compile(src)
    // With a new trace, the old cursor can point past the end. Clamp instead
    // of resetting to 0: when the user edits a line in the middle, they want
    // to stay near where they're looking.
    set({ source: src, compiled, stepIndex: clampStep(get().stepIndex, compiled.events.length) })
  },

  setStep: n => set({ stepIndex: clampStep(n, get().compiled.events.length) }),

  loadLesson: id => {
    const src = lessonSource(id)
    if (src === null) return
    // Breakpoints are cleared on a NEW program, not on every edit: line 7 of
    // the previous lesson has nothing to do with line 7 of this one, so
    // keeping them would leave stops in places nobody chose. While editing
    // (`setSource`) they are kept — the lines the user is working on are
    // exactly the ones they still care about.
    const current = get()
    set({
      source: src, compiled: compile(src), stepIndex: 0, lessonId: id, breakpoints: [],
      previousSource: current.source, previousLessonId: current.lessonId, canRestoreSource: true,
      sourceLoadRevision: current.sourceLoadRevision + 1,
    })
  },

  // Differs from `setSource` in two places, and both are needed: CLEARS
  // lessonId (otherwise "Start from blank" and "Open example" would leave the
  // old lesson chip lit up in the nav while the editor already holds
  // completely different code), and RESETS the cursor to 0 (clamping the old
  // cursor like setSource does is right while mid-edit, but jumping into the
  // middle of a program that was just opened makes no sense).
  loadSource: src => {
    const current = get()
    set({
      source: src, compiled: compile(src), stepIndex: 0, lessonId: null, breakpoints: [],
      previousSource: current.source, previousLessonId: current.lessonId, canRestoreSource: true,
      sourceLoadRevision: current.sourceLoadRevision + 1,
    })
  },

  restoreSource: () => {
    const current = get()
    if (current.previousSource === null) return
    set({
      source: current.previousSource, compiled: compile(current.previousSource), stepIndex: 0,
      lessonId: current.previousLessonId, breakpoints: [], previousSource: null,
      previousLessonId: null, canRestoreSource: false, sourceLoadRevision: current.sourceLoadRevision + 1,
    })
  },

  toggleBreakpoint: line => set(st => ({
    breakpoints: st.breakpoints.includes(line)
      ? st.breakpoints.filter(l => l !== line)
      // Kept sorted so the list reads in source order everywhere it's shown.
      : [...st.breakpoints, line].sort((a, b) => a - b),
  })),

  clearBreakpoints: () => set({ breakpoints: [] }),
}))

export { LESSON_LIST }
