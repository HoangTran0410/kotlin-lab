import { describe, expect, it } from 'vitest'
import { loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'
import type { Event } from '../../src/engine/trace/events'

/**
 * Each new lesson is anchored by the EXACT thing it teaches, not just by output.
 *
 * Output is already compared line by line against real JVM output by
 * `jvm-parity.test.ts`, so repeating that here would be redundant. What output
 * CANNOT prove is *why*: all four of these lessons could print exactly that many
 * lines for the wrong reason (a job that's supposed to have no parent turns out
 * to have one, cancelAndJoin turns out not to wait, async runs sequentially and
 * still produces the same total). The cases below target exactly that.
 */
const run = (id: string) => runSource(loadLessonSource(id))
const printed = (e: Event, s: string): boolean => e.k === 'PRINTLN' && e.text.startsWith(s)
const indexOfPrint = (evts: Event[], s: string): number => evts.findIndex(e => printed(e, s))

describe('cleanup — cancellation and cleanup', () => {
  it('finally runs AFTER the cancellation arrives, not before', () => {
    const e = run('cleanup').events
    const cancel = e.findIndex(x => x.k === 'CANCEL_REQUESTED')
    expect(cancel).toBeGreaterThanOrEqual(0)
    expect(indexOfPrint(e, '3. finally')).toBeGreaterThan(cancel)
  })

  it('cancelAndJoin() WAITS for finally to finish before returning', () => {
    // This is the entire difference between `cancel()` and `cancelAndJoin()`. If
    // someone wires cancelAndJoin straight into cancel (a bug the interpreter
    // actually had once), line 4 would jump ahead of line 3 and this case goes red.
    const e = run('cleanup').events
    expect(indexOfPrint(e, '4. cancelAndJoin')).toBeGreaterThan(indexOfPrint(e, '3. finally'))
  })

  it('the job ends at Cancelled, not Completed', () => {
    const e = run('cleanup').events
    const job = e.find(x => x.k === 'COROUTINE_CREATED' && x.varName === 'job')!
    const id = (job as { id: string }).id
    const last = e.filter(x => x.k === 'JOB_STATE' && x.id === id).at(-1)
    expect(last).toMatchObject({ to: 'Cancelled' })
  })
})

describe('swallow — a broad catch swallows the cancellation signal', () => {
  it('emits EXCEPTION_CAUGHT of exactly type CancellationException', () => {
    const caught = run('swallow').events.filter(e => e.k === 'EXCEPTION_CAUGHT')
    expect(caught).toHaveLength(1)
    expect(caught[0]).toMatchObject({ exType: 'CancellationException' })
  })

  it('the body keeps running after swallowing it — and the Job is still Cancelled', () => {
    // Both halves have to hold for this to be the actual lesson. Checking only
    // the first half would let an engine that ignores cancellation entirely pass
    // too; checking only the second half would let an engine that kills the
    // coroutine outright at the cancel point pass too.
    const r = run('swallow')
    const job = r.events.find(x => x.k === 'COROUTINE_CREATED' && x.varName === 'job')!
    const id = (job as { id: string }).id
    expect(indexOfPrint(r.events, '3. the body keeps running')).toBeGreaterThan(0)
    const last = r.events.filter(x => x.k === 'JOB_STATE' && x.id === id).at(-1)
    expect(last).toMatchObject({ to: 'Cancelled' })
    expect(r.output.at(-1)).toBe('4. job.isCancelled = true')
  })
})

describe('parallel — sequential or parallel, only the clock tells the truth', () => {
  it('two sequential calls cost 200+200, two async calls cost only 200', () => {
    // Both halves print the identical output (both total 5) — ONLY the virtual
    // clock can tell them apart. If async got wired up to run inline instead,
    // the second half would also become 400 and this case would go red.
    const e = run('parallel').events
    const t = (s: string): number => e[indexOfPrint(e, s)]!.t
    expect(t('2. sequential done') - t('1. sequential')).toBe(400)
    expect(t('4. parallel done') - t('3. parallel')).toBe(200)
  })

  it('the two async calls are two real child jobs, both CREATED before either is awaited', () => {
    const e = run('parallel').events
    const asyncJobs = e.filter(x => x.k === 'COROUTINE_CREATED' && x.builder === 'async')
    expect(asyncJobs).toHaveLength(2)
    expect(asyncJobs.map(x => (x as { varName?: string }).varName)).toEqual(['image', 'name'])
    const firstAwait = e.findIndex(x => x.k === 'COROUTINE_SUSPENDED' && x.reason === 'await')
    expect(firstAwait).toBeGreaterThan(e.indexOf(asyncJobs[1]!))
  })
})

describe('globalscope — a coroutine with no parent', () => {
  it('the GlobalScope job has parentId null, the other job hangs under root', () => {
    const e = run('globalscope').events
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    const root = created[0] as { id: string }
    const children = created.filter(x => (x as { builder: string }).builder === 'launch')
    expect(children).toHaveLength(2)
    expect((children[0] as { parentId: string | null }).parentId).toBe(root.id)
    expect((children[1] as { parentId: string | null }).parentId).toBeNull()
  })

  it('nobody waits for it: the program ends while it is still delaying', () => {
    // Assert the positive direction — "the output doesn't contain that line"
    // would also pass if that coroutine had never been created at all. Here the
    // job MUST exist, MUST have run, and MUST stop at a suspend point with no
    // resume following it.
    const r = run('globalscope')
    const orphan = r.events.find(x => x.k === 'COROUTINE_CREATED' && x.parentId === null
      && x.builder === 'launch')!
    const id = (orphan as { id: string }).id
    expect(r.events.some(x => x.k === 'COROUTINE_STARTED' && x.id === id)).toBe(true)
    const last = r.events.filter(
      x => (x.k === 'COROUTINE_SUSPENDED' || x.k === 'COROUTINE_RESUMED') && x.id === id).at(-1)
    expect(last?.k).toBe('COROUTINE_SUSPENDED')
    expect(r.output).not.toContain('this line never prints — the program ended long ago')
  })
})
