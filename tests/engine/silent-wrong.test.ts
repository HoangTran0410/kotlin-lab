import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('error() — throws IllegalStateException, not a no-op', () => {
  it('stops execution right at the call site', () => {
    // Before the fix: printed BOTH "before" AND "after" — the error() call was swallowed silently.
    const r = runSource(`fun main() = runBlocking {
    println("before")
    error("boom")
    println("after")
}`)
    expect(r.output).toEqual(['before'])
  })

  it('can be caught with try/catch and its message read', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        error("broken")
    } catch (e: IllegalStateException) {
        println("caught: " + e.message)
    }
}`)
    expect(r.output).toEqual(['caught: broken'])
  })

  it('emits EXCEPTION_THROWN with the right type and fails the job', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { error("from child") }
}`)
    const thrown = r.events.filter(e => e.k === 'EXCEPTION_THROWN')
    expect(thrown).toHaveLength(1)
    expect(thrown[0]).toMatchObject({ exType: 'IllegalStateException', message: 'from child' })
    expect(r.events.some(e => e.k === 'FAILURE_PROPAGATED')).toBe(true)
  })

  it('carries the correct line number of the error() statement', () => {
    const r = runSource(`fun main() = runBlocking {

    error("at line three")
}`)
    const thrown = r.events.find(e => e.k === 'EXCEPTION_THROWN')!
    expect(thrown.srcLine).toBe(3)
  })
})

describe('an unsupported construct must be REPORTED, not return a garbage value', () => {
  const diagnosticsOf = (src: string) => runSource(src).diagnostics

  it('job.children is blocked, with a line number and a hint', () => {
    // Before the fix: printed the literal "Job.children" — an object that's
    // always truthy, so `if (job.children.isEmpty())` was wrong in a way you
    // couldn't see.
    const d = diagnosticsOf(`fun main() = runBlocking {
    val j = launch { delay(10) }
    println(j.children)
}`)
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(3)
    expect(d[0]!.message).toContain('children')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('Thread.currentThread() is blocked', () => {
    // Before the fix: printed "kotlin.Unit".
    const d = diagnosticsOf(`fun main() = runBlocking {
    println(Thread.currentThread().name)
}`)
    expect(d.length).toBeGreaterThan(0)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.hint).toBeTruthy()
  })

  it('CoroutineExceptionHandler is blocked in the form people ACTUALLY write', () => {
    // Not `println(CoroutineExceptionHandler)` — nobody writes that. The real
    // form is a Call with a trailing lambda, added into the root scope's
    // context: the classic Android pattern. It DOES flow through both the
    // parser and applyCtxValue (ctx.hasHandler becomes true), but the
    // scheduler never emits HANDLER_RECEIVED, so before this was blocked, this
    // snippet ran with the result of a scope that has NO handler, without a
    // single warning.
    const d = diagnosticsOf(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("caught: " + e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.launch { throw RuntimeException("boom") }
    delay(50)
}`)
    expect(d.length).toBeGreaterThan(0)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.message).toContain('CoroutineExceptionHandler')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('toString() actually runs, instead of returning "kotlin.Unit"', () => {
    // Two bugs stacked on top of each other at the same spot, found while
    // writing the about page:
    //   1. A bare `UNSUPPORTED[name]` lookup also reads Object.prototype.toString
    //      -> reported "'toString' is not supported", with `hint` being a FUNCTION leaking into the UI.
    //   2. Removing that fake diagnostic exposed the real bug: the call fell
    //      through to the last branch of evalCall and returned Unit, so it PRINTED "kotlin.Unit".
    const r = runSource(`fun main() = runBlocking {
    val i = 7
    println(i.toString())
    println("string: " + i.toString())
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['7', 'string: 7'])
  })

  it('names inherited from Object.prototype are not mistaken for unsupported constructs', () => {
    // `valueOf`, `constructor`, `hasOwnProperty`... are all valid identifiers
    // in Kotlin. A bare `[]` table lookup would block all three.
    const r = runSource(`fun main() = runBlocking {
    val valueOf = 1
    val constructor = 2
    println(valueOf + constructor)
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['3'])
  })

  it('no unsupported construct slips through and silently returns Unit', async () => {
    // Guards the POSITIVE direction: every key in the unsupported list, when
    // it appears in the source, must produce a diagnostic. This test goes red
    // if someone adds a key to the list that the validator doesn't scan that syntax form for.
    //
    // Every key currently in UNSUPPORTED is a valid identifier standing alone
    // (not a lexer keyword, doesn't require standing after a dot), so
    // `println(<key>)` — reading the key as a bare Ident — is enough to hit
    // the validator's 'Ident' branch for every key. Verified: this test form
    // covers the entirety of the current UNSUPPORTED list (including
    // children/Thread/currentThread, added recently) with no key needing a
    // different syntax form (e.g. `x.<key>`).
    const { UNSUPPORTED } = await import('../../src/engine/validator/diagnostics')
    for (const key of Object.keys(UNSUPPORTED)) {
      const d = diagnosticsOf(`fun main() = runBlocking {\n    println(${key})\n}`)
      expect(d.length, `key ${key} produced no diagnostic`).toBeGreaterThan(0)
    }
  })
})
