import { describe, expect, it } from 'vitest'
import type { CtxSummary, Event } from '../../src/engine/trace/events'
import { buildMarkers } from '../../src/ui/timeline/markers'

const CTX: CtxSummary = { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false }

describe('buildMarkers (Task 16) — vạch timeline THUẦN', () => {
  it('chỉ chọn loại đáng chú ý — bỏ THREAD_STATE/JOB_STATE và mọi loại khác', () => {
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

  it('gộp trùng theo (k, id, t) — hai CANCEL_REQUESTED cùng from/to/t chỉ ra một marker', () => {
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 5, k: 'CANCEL_REQUESTED', from: 'p', to: 'c', cause: 'Boom' },
      { seq: 2, t: 5, k: 'CANCEL_REQUESTED', from: 'p', to: 'c', cause: 'Boom' },
    ]
    const markers = buildMarkers(events)
    expect(markers.filter(m => m.kind === 'CANCEL_REQUESTED')).toHaveLength(1)
  })

  it('vị trí % đúng — (chỉ số mảng + 1) / tổng * 100', () => {
    const events: Event[] = [
      { seq: 0, t: 0, k: 'PRINTLN', id: 'p', text: 'a' },
      { seq: 1, t: 1, k: 'PRINTLN', id: 'p', text: 'b' },
      { seq: 2, t: 2, k: 'JOB_STATE', id: 'p', from: 'New', to: 'Active' },
      { seq: 3, t: 3, k: 'PRINTLN', id: 'p', text: 'c' },
    ]
    const markers = buildMarkers(events)
    expect(markers.map(m => m.pct)).toEqual([25, 50, 100])
  })

  it('trace rỗng ra mảng rỗng', () => {
    expect(buildMarkers([])).toEqual([])
  })

  it('hai EXCEPTION_THROWN cùng (id, t) gộp thành một marker — tồn đọng A3', () => {
    // Tồn đọng M1 A3: throw xuyên qua root đã unwrap phát EXCEPTION_THROWN
    // hai lần. exType/message khác nhau vẫn phải gộp — khoá gộp chỉ là (k,id,t).
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'p', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 9, k: 'EXCEPTION_THROWN', id: 'p', exType: 'Boom', message: 'lần 1' },
      { seq: 2, t: 9, k: 'EXCEPTION_THROWN', id: 'p', exType: 'Boom', message: 'lần 2 (unwrap root)' },
    ]
    const markers = buildMarkers(events)
    expect(markers.filter(m => m.kind === 'EXCEPTION_THROWN')).toHaveLength(1)
  })
})
