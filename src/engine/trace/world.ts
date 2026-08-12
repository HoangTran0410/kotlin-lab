import type { Event, JobId, JobState, ThreadId } from './events'

export interface JobView {
  id: JobId
  parentId: JobId | null
  builder: string
  state: JobState
  dispatcher: string
  name: string | null
  /** Variable name the learner assigns this coroutine to. */
  varName: string | null
  isSupervisor: boolean
  suspendReason: string | null
  threadId: ThreadId | null
  cause: string | null
  /**
   * The message that came with `cause`, when the job's Cancelling/Cancelled
   * transition carried one. Populated even when this job never threw
   * anything itself — e.g. an innocent sibling dragged down by `cancelJob`,
   * or an ordinary/scope-coroutine ancestor a child's failure climbed
   * through — because the learner still benefits from seeing WHY, and
   * `failure` below is deliberately left null in exactly those cases.
   */
  causeMessage: string | null
  /**
   * Most recent `println` line printed by THIS job itself, plus the total
   * count of lines it has printed.
   *
   * `output` at the WorldState level is a flat array carrying no id, so the
   * console can show it but the graph can't: the learner sees text land in
   * the side panel with no way to tell which node printed it. Kept here too
   * so the node itself can show the line it just printed — `PRINTLN` has
   * carried the right `id` ever since inline-scope attribution was fixed.
   */
  lastPrint: string | null
  printCount: number
  /**
   * The exception that BROKE THIS JOB, with its message.
   *
   * `cause` only carries the TYPE (`"RuntimeException"`) because it's read
   * from `JOB_STATE.cause`, and it's also present on jobs cancelled by
   * contagion — they don't have a message of their own. The real message
   * only lives in `EXCEPTION_THROWN`, and it used to die there: the graph
   * showed the plain word "RuntimeException" and the learner had to scrub to
   * the exact one event to ever read "Child 1 failed".
   */
  failure: { exType: string; message: string } | null
}

export interface ThreadView { id: ThreadId; state: 'RUNNING' | 'FREE' }

export interface WorldState {
  t: number
  jobs: Map<JobId, JobView>
  threads: Map<ThreadId, ThreadView>
  output: string[]
  /** The failure/cancel edge active at this step, for the UI to draw a token on. */
  lastEvent: Event | null
  /**
   * The job the last event was ABOUT — used to highlight the node currently
   * in play on the graph. Different from `lastEvent`: infrastructure events
   * (`THREAD_STATE`) carry no job, so this must NOT be cleared for them, or
   * the emphasis ring would flicker on and off throughout the trace — same
   * reason `srcLine` has to be sticky.
   */
  activeJobId: JobId | null
  /**
   * 1-based line currently running, or null if no event has carried a line
   * yet. STICKY: an event without `srcLine` does NOT clear the old value. If
   * it did, the highlighted line would flicker on/off throughout the trace,
   * because infrastructure events (THREAD_STATE, JOB_STATE) are interleaved
   * between every step and belong to no line.
   */
  srcLine: number | null
}

/** The world before any event has happened. */
export function emptyWorld(): WorldState {
  return {
    t: 0, jobs: new Map(), threads: new Map(), output: [],
    lastEvent: null, activeJobId: null, srcLine: null,
  }
}

/**
 * Apply ONE event onto `w`, in place.
 *
 * Split out of `foldTrace` so that `narrateTrace` (engine/narrate) can roll
 * the world forward with this exact logic instead of duplicating it. Two
 * fold implementations drifting apart is the kind of bug nobody catches
 * until the narration says one thing and the graph draws another — and by
 * then no test points at which side is wrong.
 *
 * Deliberately mutates: this is the inner loop of both `foldTrace` and
 * `narrateTrace`, and allocating a fresh WorldState per event would be O(N)
 * copies of the whole Map. Purity is kept at the outer layer — `foldTrace`
 * always starts from `emptyWorld`.
 */
export function applyEvent(w: WorldState, e: Event): void {
  w.t = e.t
  w.lastEvent = e
  if (e.srcLine !== undefined) w.srcLine = e.srcLine
  // STICKY like srcLine: an infrastructure event carrying no job leaves the old job untouched.
  if ('id' in e && typeof e.id === 'string') w.activeJobId = e.id
  else if (e.k === 'FAILURE_PROPAGATED' || e.k === 'CANCEL_REQUESTED') w.activeJobId = e.to

  switch (e.k) {
    case 'COROUTINE_CREATED':
      w.jobs.set(e.id, {
        id: e.id, parentId: e.parentId, builder: e.builder, state: 'New',
        dispatcher: e.ctx.dispatcher, name: e.ctx.name, varName: e.varName ?? null,
        isSupervisor: e.ctx.isSupervisor,
        suspendReason: null, threadId: null, cause: null, causeMessage: null,
        lastPrint: null, printCount: 0, failure: null,
      })
      break
    case 'JOB_STATE': {
      const j = w.jobs.get(e.id)
      if (j) { j.state = e.to; if (e.cause) { j.cause = e.cause; j.causeMessage = e.causeMessage ?? null } }
      break
    }
    case 'COROUTINE_STARTED':
    case 'COROUTINE_RESUMED': {
      const j = w.jobs.get(e.id)
      if (j) { j.threadId = e.threadId; j.suspendReason = null }
      break
    }
    case 'COROUTINE_SUSPENDED': {
      const j = w.jobs.get(e.id)
      if (j) { j.suspendReason = e.reason; j.threadId = null }
      break
    }
    case 'DISPATCH': {
      const j = w.jobs.get(e.id)
      if (j) j.threadId = e.threadId
      break
    }
    case 'THREAD_STATE':
      w.threads.set(e.threadId, { id: e.threadId, state: e.state })
      break
    case 'EXCEPTION_THROWN': {
      const j = w.jobs.get(e.id)
      if (j) j.failure = { exType: e.exType, message: e.message }
      break
    }
    case 'PRINTLN': {
      w.output.push(e.text)
      const j = w.jobs.get(e.id)
      if (j) { j.lastPrint = e.text; j.printCount++ }
      break
    }
    default:
      break
  }
}

/** Rebuild state by applying events [0, upTo). Pure function. */
export function foldTrace(events: readonly Event[], upTo: number): WorldState {
  const w = emptyWorld()
  const n = Math.max(0, Math.min(upTo, events.length))
  for (let i = 0; i < n; i++) applyEvent(w, events[i]!)
  return w
}
