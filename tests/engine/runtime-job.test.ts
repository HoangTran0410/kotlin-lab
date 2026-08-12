import { describe, expect, it } from 'vitest'
import { Job } from '../../src/engine/runtime/job'

describe('Job state machine', () => {
  it('starts in the New state', () => {
    expect(new Job('j1', 'root', null, false).state).toBe('New')
  })

  it('transitions New -> Active -> Completing -> Completed', () => {
    const j = new Job('j1', 'root', null, false)
    j.transitionTo('Active'); j.transitionTo('Completing'); j.transitionTo('Completed')
    expect(j.state).toBe('Completed')
    expect(j.isCompleted).toBe(true)
  })

  it('blocks an invalid state transition', () => {
    const j = new Job('j1', 'root', null, false)
    j.transitionTo('Active'); j.transitionTo('Completed')
    expect(() => j.transitionTo('Active')).toThrow(/invalid/)
  })

  it('addChild links both directions', () => {
    const p = new Job('p', 'parent', null, false)
    const c = new Job('c', 'child', p, false)
    p.addChild(c)
    expect(p.children).toEqual([c])
    expect(c.parent).toBe(p)
  })

  it('children keeps insertion order — this is what makes it deterministic', () => {
    const p = new Job('p', 'parent', null, false)
    const ids = ['a', 'b', 'c']
    ids.forEach(id => p.addChild(new Job(id, id, p, false)))
    expect(p.children.map(c => c.id)).toEqual(ids)
  })

  it('descendants traverses depth-first, in stable order', () => {
    const root = new Job('r', 'r', null, false)
    const a = new Job('a', 'a', root, false); root.addChild(a)
    const b = new Job('b', 'b', root, false); root.addChild(b)
    const a1 = new Job('a1', 'a1', a, false); a.addChild(a1)
    expect(root.descendants().map(j => j.id)).toEqual(['a', 'a1', 'b'])
  })

  it('isActive is true only when Active', () => {
    const j = new Job('j', 'j', null, false)
    expect(j.isActive).toBe(false)
    j.transitionTo('Active')
    expect(j.isActive).toBe(true)
  })

  it('isCompleted DIFFERS from !isActive — a freshly created job (New) has both false', () => {
    // Task 19 made `New` no longer observable from Kotlin code (spawn now
    // transitions to Active immediately), so the old guard in
    // job-state.test.ts (which relied on Kotlin code being able to observe a
    // job in the New state) no longer catches the "isCompleted = !isActive"
    // mutation — measured: applying that mutation to job.ts and running ALL
    // 510 tests, none of them went red. A freshly created job (state New) is
    // still the ONLY remaining shape at the Job level that distinguishes the
    // two, so the guard had to move down here, to Job's own unit tests.
    const j = new Job('j', 'j', null, false)
    expect(j.isActive).toBe(false)
    expect(j.isCompleted).toBe(false)
  })

  it('isCancelled is true once Cancelled', () => {
    const j = new Job('j', 'j', null, false)
    j.transitionTo('Active'); j.transitionTo('Cancelling'); j.transitionTo('Cancelled')
    expect(j.isCancelled).toBe(true)
    expect(j.isCompleted).toBe(true)
  })

  it('state has no setter — only changeable via transitionTo', () => {
    // If state were a public field, every downstream module could assign it
    // directly and the ALLOWED table would become useless.
    const desc = Object.getOwnPropertyDescriptor(Job.prototype, 'state')
    expect(desc?.get).toBeTypeOf('function')
    expect(desc?.set).toBeUndefined()
  })

  it("addChild throws when child.parent does not point back to this job", () => {
    const p = new Job('p', 'P', null, false)
    const other = new Job('o', 'O', null, false)
    const orphan = new Job('c', 'C', other, false)
    expect(() => p.addChild(orphan)).toThrow(/bidirectionally consistent/)
  })

  it('addChild throws when the child has no parent', () => {
    const p = new Job('p', 'P', null, false)
    const rootless = new Job('c', 'C', null, false)
    expect(() => p.addChild(rootless)).toThrow(/bidirectionally consistent/)
  })

  it('addChild runs normally when the link is bidirectionally consistent', () => {
    const p = new Job('p', 'P', null, false)
    const c = new Job('c', 'C', p, false)
    expect(() => p.addChild(c)).not.toThrow()
    expect(p.children).toEqual([c])
  })

  it('transitioning to the CURRENT state is rejected', () => {
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active')
    expect(() => j.transitionTo('Active')).toThrow(/invalid/)
  })

  it('New -> Cancelled works directly (a job that never ran can be cancelled immediately)', () => {
    const j = new Job('j', 'J', null, false)
    expect(() => j.transitionTo('Cancelled')).not.toThrow()
    expect(j.isCancelled).toBe(true)
  })
})
