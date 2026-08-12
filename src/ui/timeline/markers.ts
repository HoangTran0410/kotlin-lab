import type { Event } from '../../engine/trace/events'

/** Event kinds "notable" enough to draw a mark on the timeline. */
export type NotableKind =
  | 'COROUTINE_CREATED'
  | 'EXCEPTION_THROWN'
  | 'FAILURE_PROPAGATED'
  | 'CANCEL_REQUESTED'
  | 'PRINTLN'

export interface Marker {
  kind: NotableKind
  /**
   * The event's "actor", used as part of the dedup key (k, id, t). Events
   * carrying `id` (COROUTINE_CREATED/EXCEPTION_THROWN/PRINTLN) use that id
   * directly; events that only carry `from`/`to`
   * (FAILURE_PROPAGATED/CANCEL_REQUESTED) use the pair `"from->to"` as their
   * identity — there's no single `id` field to use for these two kinds.
   */
  actorId: string
  /** Virtual time (world.t) at the FIRST occurrence merged into this marker. */
  t: number
  /**
   * Position 0-100 along the timeline. The timeline runs [0, events.length]
   * (Task 16 step 2: the endpoint is events.length, NOT the moment root
   * Completes) — the event at 0-based array index `i` only REALLY appears in
   * the world when stepIndex >= i+1 (foldTrace applies events [0, upTo)), so
   * its natural position on the bar is (i+1)/events.length*100: dragging
   * exactly there is when the mark "lights up".
   */
  pct: number
}

interface NotableInfo {
  kind: NotableKind
  actorId: string
}

/**
 * A non-notable event (including THREAD_STATE/JOB_STATE — 91/159 events
 * across the three lessons, which would pack the bar solid with marks)
 * returns null. Switches on `e.k` so TypeScript narrows `e` on its own in
 * each branch — no type casting needed.
 */
function notableInfo(e: Event): NotableInfo | null {
  switch (e.k) {
    case 'COROUTINE_CREATED':
    case 'EXCEPTION_THROWN':
    case 'PRINTLN':
      return { kind: e.k, actorId: e.id }
    case 'FAILURE_PROPAGATED':
    case 'CANCEL_REQUESTED':
      return { kind: e.k, actorId: `${e.from}->${e.to}` }
    default:
      return null
  }
}

/**
 * Deduplicates by (k, id, t). Backlog item M1: EXCEPTION_THROWN fires TWICE
 * when a throw unwinds through an unwrapped root. Drawing two overlapping
 * marks would look like a render bug.
 *
 * Deduplication only affects the DRAWING. `stepIndex` still counts every
 * individual event, so scrubbing through still stops at both — the trace is
 * the source of truth, the marker is just a visual cue.
 */
export function buildMarkers(events: readonly Event[]): Marker[] {
  const seen = new Set<string>()
  const markers: Marker[] = []
  const total = events.length

  events.forEach((e, i) => {
    const info = notableInfo(e)
    if (info === null) return
    const key = `${info.kind}:${info.actorId}:${e.t}`
    if (seen.has(key)) return
    seen.add(key)
    markers.push({ ...info, t: e.t, pct: ((i + 1) / total) * 100 })
  })

  return markers
}
