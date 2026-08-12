import { describe, expect, it } from 'vitest'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

const runLesson = (id: string) => runSource(loadLessonSource(id))
const finalWorld = (id: string) => {
  const r = runLesson(id)
  return foldTrace(r.events, r.events.length)
}

describe('lesson — M1 acceptance', () => {
  it('all lessons parse and validate clean', () => {
    for (const l of LESSONS) {
      expect(runLesson(l.id).diagnostics, `lesson ${l.id}`).toEqual([])
    }
  })

  it('LESSONS are sorted ascending by order, with no duplicate order', () => {
    // Don't copy the id list here: having to edit this test every time a lesson
    // is added is exactly what makes people edit it to turn it green instead of
    // reading it. Assert the INVARIANT instead.
    const orders = LESSONS.map(l => l.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(new Set(orders).size, 'two lessons share an order').toBe(orders.length)
    expect(new Set(LESSONS.map(l => l.id)).size, 'two lessons share an id').toBe(LESSONS.length)
  })

  it('the 9 original lessons are all present and keep their relative teaching order', () => {
    // This used to be a HARD-CODED list of exactly 9 elements. It pinned two
    // different things at once — "all 9 original lessons present" and "no other
    // lesson exists" — and only the first one is actually worth keeping. Adding
    // a new lesson somewhere in the middle of the path is normal; losing an
    // original lesson, or reordering how they're taught, is not.
    const original = [
      'suspend', 'jobtree', 'exception', 'normalfail', 'supervisor',
      'launchasync', 'dispatcher', 'scopecompare', 'nestedtrap',
    ]
    const ids = LESSONS.map(l => l.id)
    expect(ids.filter(id => original.includes(id))).toEqual(original)
  })

  it('every lesson has a title, a summary, and at least two concepts', () => {
    for (const l of LESSONS) {
      expect(l.title.length, `${l.id} is missing a title`).toBeGreaterThan(5)
      expect(l.summary.length, `${l.id} is missing a summary`).toBeGreaterThan(10)
      expect(l.concepts.length, `${l.id} is missing concepts`).toBeGreaterThanOrEqual(2)
    }
  })

  describe('jobtree — cancel goes down', () => {
    it('every job reaches a FINISHED state, none stuck at New/Completing', () => {
      // Filtering on state === 'Active' isn't enough: a job stuck at 'New'
      // (never gets to run) or at 'Completing' (never finishes settling) would
      // both slip through, even though both are broken. Assert the positive
      // direction instead.
      const w = finalWorld('jobtree')
      const states = [...w.jobs.values()].map(j => j.state)
      expect(states.length).toBeGreaterThan(0)
      expect(states.filter(s => s !== 'Completed' && s !== 'Cancelled')).toEqual([])
    })

    it('CANCEL_REQUESTED goes in the CORRECT DIRECTION: from user down to parent, then parent down to its 3 children', () => {
      // Just counting >= 3 doesn't check direction at all: three events going
      // backward up, or three duplicate events, would both pass. Cancel going
      // DOWN is the rule this lesson teaches.
      const e = runLesson('jobtree').events
      const created = e.filter(x => x.k === 'COROUTINE_CREATED')
      const rootId = (created[0] as { id: string }).id
      // parent is the first launch under root; its 3 children are the remaining launches.
      const parentId = (created[1] as { id: string }).id
      const cancels = e.filter(x => x.k === 'CANCEL_REQUESTED')
        .map(x => [(x as { from: string }).from, (x as { to: string }).to])

      expect(cancels[0]).toEqual(['user', parentId])
      const fromParent = cancels.filter(([from]) => from === parentId).map(([, to]) => to)
      expect(fromParent).toHaveLength(3)
      // Exactly 3 distinct children, and no event points back up to root.
      expect(new Set(fromParent).size).toBe(3)
      expect(cancels.some(([, to]) => to === rootId)).toBe(false)
    })

    it('no job prints anything — cancelled before delay finishes', () => {
      expect(runLesson('jobtree').output).toEqual([])
    })
  })

  describe('normalfail — failure drags the sibling down', () => {
    it('emits FAILURE_PROPAGATED not blocked by a supervisor', () => {
      const e = runLesson('normalfail').events
        .filter(x => x.k === 'FAILURE_PROPAGATED')
      expect(e.length).toBeGreaterThan(0)
      expect(e.every(x => x.blockedBySupervisor === false)).toBe(true)
    })

    it('A and C do NOT print — cancelled along with it', () => {
      expect(runLesson('normalfail').output).toEqual([])
    })

    it('has an EXCEPTION_THROWN of type RuntimeException', () => {
      expect(runLesson('normalfail').events
        .some(x => x.k === 'EXCEPTION_THROWN' && x.exType === 'RuntimeException')).toBe(true)
    })
  })

  describe('supervisor — sibling keeps going', () => {
    it('emits FAILURE_PROPAGATED blocked by a supervisor', () => {
      expect(runLesson('supervisor').events
        .some(x => x.k === 'FAILURE_PROPAGATED' && x.blockedBySupervisor === true)).toBe(true)
    })

    it('A and C STILL print — this is the core difference from normalfail', () => {
      expect(runLesson('supervisor').output).toEqual(['A done', 'C done'])
    })
  })

  it('same source produces an identical trace across multiple runs — deterministic', () => {
    for (const l of LESSONS) {
      const a = JSON.stringify(runLesson(l.id).events)
      const b = JSON.stringify(runLesson(l.id).events)
      expect(a, `lesson ${l.id}`).toBe(b)
    }
  })

  it('fold does not throw at any step', () => {
    for (const l of LESSONS) {
      const evts = runLesson(l.id).events
      for (let n = 0; n <= evts.length; n++) {
        expect(() => foldTrace(evts, n)).not.toThrow()
      }
    }
  })
})
