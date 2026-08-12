import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { jobLabel } from '../../src/engine/trace/label'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'

const createdEvents = (src: string) =>
  runSource(src).events.filter(e => e.k === 'COROUTINE_CREATED')

describe('node labels — call each coroutine by the exact name the learner typed', () => {
  it('priority order: CoroutineName > variable name > builder', () => {
    expect(jobLabel({ id: 'j1', builder: 'launch', name: 'worker', varName: 'job' })).toBe('worker')
    expect(jobLabel({ id: 'j1', builder: 'launch', name: null, varName: 'job' })).toBe('job')
    expect(jobLabel({ id: 'j1', builder: 'launch', name: null, varName: null })).toBe('launch')
  })

  it('`val job = launch { }` attaches the variable name to the node', () => {
    const t = createdEvents(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val reader = launch { delay(10) }
    reader.join()
}`)
    const child = t.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    expect(child.k === 'COROUTINE_CREATED' && child.varName).toBe('reader')
  })

  it('async and CoroutineScope also pick up the variable name', () => {
    const t = createdEvents(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    val result = scope.async { 1 }
    delay(10)
    scope.cancel()
}`)
    const names = t.map(e => (e.k === 'COROUTINE_CREATED' ? e.varName ?? null : null))
    expect(names).toContain('scope')
    expect(names).toContain('result')
  })

  it('CoroutineName WINS over the variable name — what the learner deliberately typed takes priority', () => {
    const t = createdEvents(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val worker = launch(CoroutineName("tailor")) { delay(10) }
    worker.join()
}`)
    const child = t.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    if (child.k !== 'COROUTINE_CREATED') throw new Error('wrong kind')
    // Both are present in the data — priority is jobLabel's job, not
    // achieved by throwing away information at the engine layer.
    expect(child.varName).toBe('worker')
    expect(child.ctx.name).toBe('tailor')
    expect(jobLabel({ id: child.id, builder: child.builder, name: child.ctx.name, varName: child.varName }))
      .toBe('tailor')
  })

  it('launch NOT assigned to a variable has no varName', () => {
    const t = createdEvents(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const child = t.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    expect(child.k === 'COROUTINE_CREATED' && child.varName).toBeUndefined()
  })

  it('variable name does NOT leak into a coroutine spawned INSIDE a right-hand-side call', () => {
    // The easiest place for this implementation to get it wrong: if it only
    // remembers "a variable name is pending" and pastes it onto the NEXT
    // spawn, then the coroutine spawned INSIDE `createWork()` — which runs
    // WHILE the right-hand side is being evaluated — would steal the name
    // `result`.
    //
    // The function here MUST actually spawn something. The first version of
    // this test called a function that spawns nothing, so removing the
    // syntax check entirely still left it green — an empty guard. Re-measured:
    // with a function that does spawn, it goes red exactly as it should.
    const r = runSource(`import kotlinx.coroutines.*

suspend fun createWork(): Int {
    coroutineScope {
        launch { delay(1) }
    }
    return 1
}

fun main() = runBlocking {
    val result = createWork()
    println(result)
}`)
    expect(r.diagnostics).toEqual([])
    const children = r.events.filter(e => e.k === 'COROUTINE_CREATED')
    for (const c of children) {
      expect(c.k === 'COROUTINE_CREATED' && c.varName,
        `${c.k === 'COROUTINE_CREATED' ? c.builder : '?'} inside createWork() ended up carrying the caller's variable name`)
        .toBeUndefined()
    }
    expect(r.output).toEqual(['1'])
  })

  it('variable name is NOT stolen by a coroutine spawned while EVALUATING AN ARGUMENT', () => {
    // `launch(cleanup())` — `cleanup()` runs BEFORE launch spawns, and it
    // spawns on its own. If the variable name isn't captured-and-cleared
    // before the argument is evaluated, the coroutine inside `cleanup()`
    // would receive the label `primary`.
    const r = runSource(`import kotlinx.coroutines.*

suspend fun cleanup(): Int {
    coroutineScope {
        launch { delay(1) }
    }
    return 1
}

fun main() = runBlocking {
    val primary = launch(cleanup()) { delay(10) }
    primary.join()
}`)
    expect(r.diagnostics).toEqual([])
    const labeledPrimary = r.events.filter(
      e => e.k === 'COROUTINE_CREATED' && e.varName === 'primary')
    expect(labeledPrimary, 'exactly ONE coroutine is labeled `primary`').toHaveLength(1)
    // And it must be the one that RUNS for 10ms, not the cleanup one inside cleanup().
    const theOne = labeledPrimary[0]!
    expect(theOne.k === 'COROUTINE_CREATED' && theOne.builder).toBe('launch')
    const childrenOfCleanup = r.events.filter(
      e => e.k === 'COROUTINE_CREATED' && e.parentId !== null
        && r.events.some(p => p.k === 'COROUTINE_CREATED' && p.id === e.parentId
          && p.builder === 'coroutineScope'))
    for (const c of childrenOfCleanup) {
      expect(c.k === 'COROUTINE_CREATED' && c.varName,
        'coroutine inside cleanup() stole the caller\'s variable name').toBeUndefined()
    }
  })

  it('narration calls the coroutine by that exact variable name', () => {
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val printer = launch { println("hello") }
    printer.join()
}`)
    const lines = narrateTrace(r.events).map(l => l.text)
    expect(lines.some(c => c.includes('printer')), 'no sentence calls it by the variable name').toBe(true)
    // And it's NOT called "launch j2" anymore.
    expect(lines.some(c => c.includes('`launch`'))).toBe(false)
  })
})
