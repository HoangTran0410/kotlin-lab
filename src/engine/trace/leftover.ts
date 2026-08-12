import type { Event } from './events'
import { jobLabel } from './label'
import { foldTrace, type JobView } from './world'

/**
 * Coroutines still unfinished when the program ends.
 *
 * Why this is needed: the program stops when the ROOT coroutine stops, just
 * like the JVM exits right after `main` returns and kills every daemon
 * thread. So `fun main() { ... }` (the block form, no `runBlocking`) finishes
 * in 0ms and leaves behind everything it just launched — nothing printed,
 * nothing thrown, no error at all.
 *
 * Real Kotlin behaves exactly the same way (checked: a program shaped like
 * this produces EMPTY output on the playground). But "correct and silent" is
 * broken here: the learner sees a blank screen with nothing telling them why.
 * This is exactly the spot where a teaching tool has to say more than the
 * compiler does.
 *
 * DELIBERATELY not a Diagnostic: the code has no syntax error, and it
 * compiles clean on real Kotlin. This is a RUNTIME event, so it belongs on
 * the trace.
 */
export interface UnfinishedCoroutines {
  /** Jobs that had not reached a terminal state when the trace ran out. */
  jobs: JobView[]
  /** Labels to display, in the same order as `jobs`. */
  labels: string[]
}

const NOT_DONE = new Set(['New', 'Active', 'Completing', 'Cancelling'])

export function unfinishedCoroutines(events: readonly Event[]): UnfinishedCoroutines {
  const w = foldTrace(events, events.length)
  const jobs = [...w.jobs.values()].filter(j => NOT_DONE.has(j.state))
  return { jobs, labels: jobs.map(jobLabel) }
}

/**
 * Whether the program is shaped like `fun main() { ... }` WITHOUT
 * runBlocking — the number-one cause of "it ran and nothing happened".
 *
 * Reads the SOURCE, not the AST: this function is called from the UI with
 * the source string it already has on hand, and it's only used to pick which
 * hint to show, never to decide any engine behavior. Getting it wrong costs,
 * at worst, a hint in the wrong place.
 */
export function missingRunBlocking(src: string): boolean {
  return !/\brunBlocking\b/.test(src)
}
