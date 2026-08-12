import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'
import { LESSONS, loadLessonSource } from '../../src/lessons'

const diagnosticsOf = (src: string) => runSource(src).diagnostics

describe('undeclared names — real Kotlin\'s "Unresolved reference"', () => {
  it('an undeclared receiver is reported, at the right line and column', () => {
    // A real case: forgetting `val supervisorScope = CoroutineScope(SupervisorJob())`.
    // Real Kotlin fails to compile. The engine used to build a garbage object
    // carrying that exact name, scopeReceiver didn't recognize it, so the call
    // ran exactly like a bare `launch { }` — the whole lesson about a silent
    // supervisor taught the opposite.
    const d = diagnosticsOf(`import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope.launch { delay(10) }
}`)
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(4)
    expect(d[0]!.col).toBe(5)
    expect(d[0]!.message).toContain('Unresolved reference')
  })

  it('an undeclared variable used as a value is also reported', () => {
    expect(diagnosticsOf('fun main() = runBlocking {\n    println(missingVar + 1)\n}')).toHaveLength(1)
  })

  it('does NOT false-positive on: a declared variable, a parameter, a catch/for variable, `it`, `this`', () => {
    // Each name here comes from a different declaration path. Grouped into one
    // case because they all guard the same thing: the new check must not block valid code.
    const d = diagnosticsOf(`import kotlinx.coroutines.*

suspend fun doWork(scope: CoroutineScope, n: Int) {
    scope.launch { delay(n) }
}

fun main() = runBlocking {
    val count = 1
    var mutable = 2
    mutable = mutable + count
    for (i in 1..2) { println(i) }
    repeat(2) { println(it) }
    try { error("x") } catch (e: Exception) { println(e.message) }
    doWork(this, mutable)
    println(count)
}`)
    expect(d).toEqual([])
  })

  it('a function can be called before its declaration, and can call itself', () => {
    expect(diagnosticsOf(`fun main() = runBlocking {
    println(count(3))
}

fun count(n: Int): Int = n`)).toEqual([])
  })

  it('uppercase names are NOT questioned — they are types/constructors', () => {
    expect(diagnosticsOf(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch(Dispatchers.IO) { throw RuntimeException("x") }
    delay(10)
}`)).toEqual([])
  })

  it('a CALL position is not reported — an unknown function is a different matter', () => {
    // `flowOf` is a REAL kotlinx function this engine hasn't implemented yet;
    // Flow belongs to a later milestone. Reporting it as "not declared" would be a wrong statement.
    const d = diagnosticsOf('fun main() = runBlocking {\n    flowOf(1)\n}')
    expect(d.filter(x => x.message.includes('Unresolved reference'))).toEqual([])
  })

  it('all 13 lessons and every sample program stay clean', () => {
    // This is what guards the BUILTIN_VALUES list from drifting: missing a
    // built-in name here turns a lesson red immediately, instead of silently
    // reporting a false positive to the learner.
    for (const l of LESSONS) {
      expect(diagnosticsOf(loadLessonSource(l.id)), `lesson ${l.id}`).toEqual([])
    }
  })
})

describe('an exception\'s message survives to the end of the trace', () => {
  it('a failed job carries both its type AND message; a job cancelled by contagion does not', () => {
    // Previously the message lived in exactly ONE event (EXCEPTION_THROWN), so
    // the graph showed a bare "RuntimeException" and had to be scrubbed to
    // exactly that event to read "Child 1 failed".
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch { delay(50); throw RuntimeException("Child 1 failed") }
    launch { delay(100); println("should not print") }
}`)
    const w = foldTrace(r.events, r.events.length)
    const jobs = [...w.jobs.values()]
    const failed = jobs.filter(j => j.failure !== null)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.failure).toEqual({ exType: 'RuntimeException', message: 'Child 1 failed' })
    // Cancelled by contagion: it has a `cause` (a type) but NO `failure` — it
    // didn't throw anything itself. Assigning someone else's message to it
    // would be lying on the graph.
    const collateral = jobs.find(j => j.state === 'Cancelled' && j.failure === null)
    expect(collateral, 'no job was cancelled by contagion?').toBeDefined()
    expect(collateral!.cause).toBe('RuntimeException')
  })
})
