import type { Event } from '../trace/events'
import { applyEvent, emptyWorld } from '../trace/world'
import { narrate } from './narrate'

/** Tone of a narration line. The display layer uses it for coloring; it carries no engine meaning. */
export type NarrationTone = 'normal' | 'fail' | 'cancel' | 'output' | 'start'

export interface NarrationLine {
  /** Index into the `events` array. The UI uses this to jump to the right step. */
  index: number
  seq: number
  /** Virtual milliseconds. */
  t: number
  text: string
  tone: NarrationTone
}

function toneOf(e: Event): NarrationTone {
  switch (e.k) {
    case 'EXCEPTION_THROWN':
    case 'FAILURE_PROPAGATED':
      return 'fail'
    case 'CANCEL_REQUESTED':
      return 'cancel'
    case 'JOB_STATE':
      return e.to === 'Cancelled' || e.to === 'Cancelling' ? 'cancel' : 'normal'
    case 'PRINTLN':
      return 'output'
    case 'COROUTINE_CREATED':
    case 'COROUTINE_STARTED':
      return 'start'
    default:
      return 'normal'
  }
}

/**
 * Narrates the whole trace in ONE pass.
 *
 * Does not call `foldTrace` per event: fold rebuilds from scratch every
 * time, so doing that would be O(N²) — measured at M2: 3.9 seconds on a
 * 16,000-event trace. Here the world is rolled forward incrementally with
 * `applyEvent`, the exact function `foldTrace` uses, so there's no second
 * fold implementation to drift out of sync.
 *
 * `narrate` is called BEFORE `applyEvent` — the sentence talks about the
 * world right before the event.
 */
export function narrateTrace(events: readonly Event[]): NarrationLine[] {
  const out: NarrationLine[] = []
  const w = emptyWorld()
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const text = narrate(e, w)
    if (text !== null) out.push({ index: i, seq: e.seq, t: e.t, text, tone: toneOf(e) })
    applyEvent(w, e)
  }
  return out
}
