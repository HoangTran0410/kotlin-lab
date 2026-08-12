import type { Event } from './events'

/**
 * Breakpoint queries over a finished trace.
 *
 * Worth being precise about what a breakpoint IS here, because it is not what
 * a JVM debugger does: the whole trace is computed up front and is
 * deterministic, so "run to the breakpoint" is a SEARCH THROUGH THE TRACE, not
 * a process being suspended. That is why it can also run BACKWARDS, and why
 * hitting one costs nothing.
 *
 * The consequence to keep in mind: a breakpoint marks a line, and a line can
 * be reached many times (a loop, or three coroutines running the same body).
 * Each of those is a separate stop.
 */

/** Every source line that any event in the trace touches. */
export function linesInTrace(events: readonly Event[]): Set<number> {
  const out = new Set<number>()
  for (const e of events) if (e.srcLine !== undefined) out.add(e.srcLine)
  return out
}

/**
 * The step index to stop at for the first breakpoint hit strictly AFTER
 * `from`, or null if there is none ahead.
 *
 * Returns `i + 1`, not `i`: a step index means "this many events have been
 * applied", so stopping ON the line means the event that reached it must
 * already be folded in. Returning `i` would stop one event short and
 * highlight the previous line — the classic off-by-one that makes a debugger
 * feel broken.
 */
export function nextBreakpointStep(
  events: readonly Event[], from: number, lines: ReadonlySet<number>,
): number | null {
  if (lines.size === 0) return null
  for (let i = Math.max(0, from); i < events.length; i++) {
    const line = events[i]!.srcLine
    // `i + 1 > from` and not `i >= from`: standing exactly on a hit must not
    // re-report that same hit, or "continue" would never leave the line.
    if (line !== undefined && lines.has(line) && i + 1 > from) return i + 1
  }
  return null
}

/**
 * The step index of the last breakpoint hit strictly BEFORE `from`, or null.
 *
 * Backwards only makes sense because the trace is a finished record; a real
 * debugger cannot offer it. Since the tool can, not offering it would be a
 * loss for no reason.
 */
export function prevBreakpointStep(
  events: readonly Event[], from: number, lines: ReadonlySet<number>,
): number | null {
  if (lines.size === 0) return null
  for (let i = Math.min(from - 2, events.length - 1); i >= 0; i--) {
    const line = events[i]!.srcLine
    if (line !== undefined && lines.has(line)) return i + 1
  }
  return null
}

/** Is the step being viewed sitting exactly on a breakpoint hit? */
export function isBreakpointStep(
  events: readonly Event[], step: number, lines: ReadonlySet<number>,
): boolean {
  if (lines.size === 0 || step <= 0 || step > events.length) return false
  const line = events[step - 1]!.srcLine
  return line !== undefined && lines.has(line)
}
