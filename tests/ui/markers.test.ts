import { describe, expect, it } from 'vitest'
import type { CtxSummary, Event } from '../../src/engine/trace/events'
import { buildMarkers } from '../../src/ui/timeline/markers'

const CTX: CtxSummary = { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false }

describe('buildMarkers (Task 16) — PURE timeline marks', () => {
  it('only picks notable kinds — drops THREAD_STATE/JOB_STATE and everything else', () => {
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 0, k: 'JOB_STATE', id: 'p', from: 'New', to: 'Active' },
      { seq: 2, t: 1, k: 'COROUTINE_STARTED', id: 'p', threadId: 'Main-1' },
      { seq: 3, t: 1, k: 'THREAD_STATE', threadId: 'Main-1', state: 'RUNNING' },
      { seq: 4, t: 2, k: 'COROUTINE_SUSPENDED', id: 'p', reason: 'delay' },
      { seq: 5, t: 3, k: 'COROUTINE_RESUMED', id: 'p', threadId: 'Main-1' },
      { seq: 6, t: 4, k: 'EXCEPTION_THROWN', id: 'p', exType: 'Boom', message: 'boom' },
      { seq: 7, t: 4, k: 'EXCEPTION_CAUGHT', id: 'p', exType: 'Boom' },
      { seq: 8, t: 5, k: 'FAILURE_PROPAGATED', from: 'p', to: 'root', blockedBySupervisor: false },
      { seq: 9, t: 6, k: 'CANCEL_REQUESTED', from: 'user', to: 'p', cause: 'Boom' },
      { seq: 10, t: 6, k: 'HANDLER_RECEIVED', id: 'p', handler: 'CEH', exType: 'Boom' },
      { seq: 11, t: 7, k: 'DISPATCH', id: 'p', dispatcher: 'Main', threadId: 'Main-1' },
      { seq: 12, t: 8, k: 'PRINTLN', id: 'p', text: 'hi' },
    ]

    const kinds = buildMarkers(events).map(m => m.kind)
    expect(kinds).toEqual([
      'COROUTINE_CREATED', 'EXCEPTION_THROWN', 'FAILURE_PROPAGATED', 'CANCEL_REQUESTED', 'PRINTLN',
    ])
  })

  it('deduplicates by (k, id, t) — two CANCEL_REQUESTED with the same from/to/t produce one marker', () => {
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 5, k: 'CANCEL_REQUESTED', from: 'p', to: 'c', cause: 'Boom' },
      { seq: 2, t: 5, k: 'CANCEL_REQUESTED', from: 'p', to: 'c', cause: 'Boom' },
    ]
    const markers = buildMarkers(events)
    expect(markers.filter(m => m.kind === 'CANCEL_REQUESTED')).toHaveLength(1)
  })

  it('% position is correct — (array index + 1) / total * 100', () => {
    const events: Event[] = [
      { seq: 0, t: 0, k: 'PRINTLN', id: 'p', text: 'a' },
      { seq: 1, t: 1, k: 'PRINTLN', id: 'p', text: 'b' },
      { seq: 2, t: 2, k: 'JOB_STATE', id: 'p', from: 'New', to: 'Active' },
      { seq: 3, t: 3, k: 'PRINTLN', id: 'p', text: 'c' },
    ]
    const markers = buildMarkers(events)
    expect(markers.map(m => m.pct)).toEqual([25, 50, 100])
  })

  it('empty trace produces an empty array', () => {
    expect(buildMarkers([])).toEqual([])
  })

  it('two EXCEPTION_THROWN with the same (id, t) merge into one marker — backlog item A3', () => {
    // Backlog item M1 A3: a throw unwinding through an unwrapped root fires
    // EXCEPTION_THROWN twice. Different exType/message must still merge — the
    // dedup key is only (k,id,t).
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 9, k: 'EXCEPTION_THROWN', id: 'p', exType: 'Boom', message: 'first time' },
      { seq: 2, t: 9, k: 'EXCEPTION_THROWN', id: 'p', exType: 'Boom', message: 'second time (root unwrap)' },
    ]
    const markers = buildMarkers(events)
    expect(markers.filter(m => m.kind === 'EXCEPTION_THROWN')).toHaveLength(1)
  })
})
