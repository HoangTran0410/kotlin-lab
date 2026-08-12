import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../src/engine/runtime/clock'

describe('VirtualClock', () => {
  it('starts at 0', () => {
    expect(new VirtualClock().now).toBe(0)
  })

  it('advance jumps to the nearest timer and runs its callback', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    expect(c.advanceToNextTimer()).toBe(true)
    expect({ now: c.now, fired }).toEqual({ now: 100, fired: ['a'] })
  })

  it('runs timers in increasing time order', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(300, () => fired.push('c'))
    c.schedule(100, () => fired.push('a'))
    c.schedule(200, () => fired.push('b'))
    while (c.advanceToNextTimer()) { /* drain everything */ }
    expect(fired).toEqual(['a', 'b', 'c'])
  })

  it('timers due at the same instant run in registration order — guarantees determinism', () => {
    // This test pins down the CONTRACT the scheduler relies on, not the
    // mechanism. Honest note: the secondary `a.seq - b.seq` tiebreaker in the
    // comparator is functionally REDUNDANT — Array.sort has been stable
    // since ES2019, so insertion order is already preserved. Verified
    // experimentally: removing that tiebreaker still leaves the test green.
    // Kept because it states the intent clearly and would still hold if the
    // underlying structure ever changed to something unstable (a heap, say).
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    c.schedule(50, () => fired.push('early'))
    c.schedule(100, () => fired.push('b'))
    c.schedule(100, () => fired.push('c'))
    while (c.advanceToNextTimer()) { /* drain everything */ }
    expect(fired).toEqual(['early', 'a', 'b', 'c'])
  })

  it('a timer scheduled for the SAME instant while a callback is running still fires, is not dropped', () => {
    // Nested delay(0) produces exactly this situation. Must use the SAME
    // instant: scheduling it for a different one would let the
    // advanceToNextTimer loop pick it up on a later turn regardless of the
    // implementation, and the test would lose its ability to distinguish
    // the two cases.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => {
      fired.push('outer')
      c.schedule(100, () => fired.push('inner'))
    })
    while (c.advanceToNextTimer()) { /* drain everything */ }
    expect(fired).toEqual(['outer', 'inner'])
    expect(c.now).toBe(100)
  })

  it('a timer that reschedules itself does not hang the loop forever', () => {
    const c = new VirtualClock()
    let n = 0
    const tick = () => { if (++n < 3) c.schedule(c.now, tick) }
    c.schedule(10, tick)
    while (c.advanceToNextTimer()) { /* drain everything */ }
    expect(n).toBe(3)
    expect(c.now).toBe(10)
  })

  it('cancel removes a timer that has not fired yet', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    const id = c.schedule(100, () => fired.push('a'))
    c.cancel(id)
    expect(c.advanceToNextTimer()).toBe(false)
    expect(fired).toEqual([])
  })

  it('advance returns false once there are no timers left', () => {
    expect(new VirtualClock().advanceToNextTimer()).toBe(false)
  })

  it('time never goes backwards', () => {
    const c = new VirtualClock()
    c.schedule(100, () => {})
    c.advanceToNextTimer()
    c.schedule(50, () => {})
    c.advanceToNextTimer()
    expect(c.now).toBe(100)
  })
})
