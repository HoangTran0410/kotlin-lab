import { describe, expect, it } from 'vitest'
import { parseProgram } from '../../src/engine/parser/parser'
import { runSource } from '../../src/engine/run'
import { validate } from '../../src/engine/validator/validator'

const check = (src: string) => validate(parseProgram(src))

describe('validator', () => {
  it('valid code produces no diagnostics', () => {
    expect(check('fun main() = runBlocking {\n  launch { delay(1) }\n}')).toEqual([])
  })

  it('reports an unsupported construct with the correct line number', () => {
    const d = check('fun main() = runBlocking {\n  val c = Channel<Int>()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.message).toContain('Channel')
    expect(d[0]!.message).toContain('is not supported')
  })

  it('suggests a replacement for an unsupported construct', () => {
    const d = check('fun main() {\n  select { }\n}')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('reports an error when fun main is missing', () => {
    const d = check('fun other() {\n}')
    expect(d.some(x => x.message.includes('main'))).toBe(true)
  })

  it('collects multiple errors instead of stopping at the first one', () => {
    const d = check('fun main() {\n  Channel<Int>()\n  select { }\n}')
    expect(d.length).toBeGreaterThanOrEqual(2)
  })

  it('recognizes an unsupported Flow operator called member-style', () => {
    // The Member path is the ONLY path that catches buffer/conflate/debounce/
    // combine/zip — 5 of the 13 entries in the catalog. Must be tested with a
    // name that's REALLY in UNSUPPORTED. flowOf is now also diagnosed so the
    // whole unsupported chain is reported instead of silently returning Unit.
    const d = check('fun main() {\n  flowOf(1).buffer()\n}')
    expect(d).toHaveLength(2)
    expect(d.some(x => x.message.includes('buffer'))).toBe(true)
    expect(d.some(x => x.message.includes('flowOf'))).toBe(true)
    expect(d.every(x => x.line === 2)).toBe(true)
  })

  it('recognizes withLock called member-style, separate from Mutex', () => {
    const d = check('fun main() {\n  m.withLock { }\n}')
    expect(d.some(x => x.message.includes('withLock'))).toBe(true)
  })

  it('a construct DEFERRED past M1 is REPORTED, not run silently wrong', () => {
    // Deferred must mean REPORTED. Previously every call that wasn't
    // recognized fell through to the end of evalCall and returned Unit:
    // `withTimeout(100) { ... }` ran nothing and said nothing,
    // `listOf(1).forEach { }` was silent, `println(j.getCompleted())` printed
    // the string "kotlin.Unit". Silently wrong is far worse than a clear
    // declaration error.
    //
    // isActive/isCancelled/isCompleted/ensureActive are NOT here anymore —
    // Task 4 (M3) removed them from UNSUPPORTED and implemented reading the
    // real Job; they have their own test in tests/engine/job-state.test.ts.
    for (const src of [
      'fun main() = runBlocking {\n  listOf(1).forEach { }\n}',
      'fun main() = runBlocking {\n  println(j.getCompleted())\n}',
      'fun main() = runBlocking {\n  invokeOnCompletion { }\n}',
      'fun main() = runBlocking {\n  NonCancellable\n}',
    ]) {
      const d = check(src)
      expect(d.length, src).toBeGreaterThanOrEqual(1)
      expect(d[0]!.hint, src).toBeTruthy()
      expect(d[0]!.line, src).toBe(2)
    }
  })

  it('repeat is NOT reported — it is in the subset and already implemented', () => {
    expect(check('fun main() {\n  repeat(3) { println("x") }\n}')).toEqual([])
  })

  it('GlobalScope / cancelAndJoin are NOT reported — already implemented', () => {
    expect(check(
      'fun main() = runBlocking {\n' +
      '  val j = GlobalScope.launch { delay(1) }\n' +
      '  j.cancelAndJoin()\n' +
      '}')).toEqual([])
  })

  it('a diagnostic INSIDE a string template reports the correct line, not line 1', () => {
    // A node built by the nested parser of ${...} keeps the FRAGMENT's
    // coordinates (always line 1), and the validator reads that pos directly.
    // Result: every diagnostic inside a template points at line 1 — usually
    // the `fun main()` line, unrelated to anything. The non-template form
    // right next to it is correct, which makes this bug very easy to miss.
    const d = check(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(10) }\n' +
      '  println("${j.getCompleted()}")\n' +
      '}')
    expect(d).toHaveLength(1)
    expect(d[0]!.message).toContain('getCompleted')
    expect(d[0]!.line).toBe(3)
    expect(d[0]!.col).toBe(16)
  })

  it('the $ident (no braces) form inside a template also reports the correct line', () => {
    // NonCancellable (a bare ident, not a Member) replacing the old isActive —
    // Task 4 (M3) removed isActive from UNSUPPORTED.
    const d = check('fun main() {\n  val x = 1\n  println("a $NonCancellable b")\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(3)
  })

  it('collects errors across MULTIPLE functions, not just one', () => {
    const d = check('fun a() {\n  select { }\n}\nfun main() {\n  Channel<Int>()\n}')
    expect(d.map(x => x.line)).toEqual([2, 5])
  })

  describe('bare isActive / ensureActive() outside a coroutine — real Kotlin reports unresolved reference', () => {
    // Task 4 review round: removing isActive/isCancelled/isCompleted/
    // ensureActive from UNSUPPORTED (so they'd read the real Job) accidentally
    // opened a NEW silent-wrongness path — `fun main() { println(isActive) }`
    // has no enclosing builder, real Kotlin reports a compile error
    // ("Unresolved reference"), but before this test existed the validator
    // said nothing and the interpreter printed "true" (reading the runtime's
    // root job, not flagging the learner's mistake). Cross-checked against
    // real Kotlin (api.kotlinlang.org) for both `isActive` and
    // `ensureActive()` outside every builder: both report "Unresolved reference".
    it('a bare isActive outside every coroutine builder is reported', () => {
      const d = check('fun main() {\n  println(isActive)\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.message).toContain('isActive')
      expect(d[0]!.line).toBe(2)
    })

    it('ensureActive() outside every coroutine builder is reported', () => {
      const d = check('fun main() {\n  ensureActive()\n  println("x")\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.message).toContain('ensureActive')
      expect(d[0]!.line).toBe(2)
    })

    it('a bare isActive INSIDE launch/async/runBlocking/coroutineScope/supervisorScope/withContext is NOT reported', () => {
      for (const src of [
        'fun main() = runBlocking {\n  println(isActive)\n}',
        'fun main() = runBlocking {\n  launch {\n    println(isActive)\n  }\n}',
        'fun main() = runBlocking {\n  val d = async {\n    isActive\n  }\n}',
        'fun main() = runBlocking {\n  coroutineScope {\n    println(isActive)\n  }\n}',
        'fun main() = runBlocking {\n  supervisorScope {\n    println(isActive)\n  }\n}',
        'fun main() = runBlocking {\n  withContext(Dispatchers.IO) {\n    println(isActive)\n  }\n}',
      ]) {
        expect(check(src), src).toEqual([])
      }
    })

    it('the inCoroutine flag CARRIES THROUGH a nested block that is NOT a builder (while/try/repeat) inside launch', () => {
      // Confirms the flag doesn't get "turned off" by mistake when it passes
      // through an intermediate block that isn't launch/async/... —
      // while/try/repeat are still inside the coroutine.
      const d = check(
        'fun main() = runBlocking {\n' +
        '  launch {\n' +
        '    repeat(3) {\n' +
        '      while (isActive) {\n' +
        '        try {\n' +
        '          ensureActive()\n' +
        '        } catch (e: Exception) {\n' +
        '        }\n' +
        '      }\n' +
        '    }\n' +
        '  }\n' +
        '}')
      expect(d).toEqual([])
    })

    it('job.isActive as a MEMBER (with a receiver) is NOT touched by the coroutine check', () => {
      // Only a BARE isActive (no receiver) needs an enclosing CoroutineScope.
      // job.isActive reads the state of a SPECIFIC Job, valid anywhere there's
      // a Job variable — the validator should not report an error here even
      // outside a builder.
      const d = check(
        'fun main() = runBlocking {\n' +
        '  val job = launch { delay(1) }\n' +
        '  println(job.isActive)\n' +
        '}')
      expect(d).toEqual([])
    })
  })

  describe('isActive/ensureActive can be shadowed by a learner-declared variable (Finding 4)', () => {
    // Task 4 review round 2: the new coroutine check (Finding 3) blocked BY
    // NAME, with no awareness of the symbol table — `fun main() { val isActive
    // = true; println(isActive) }` is 100% valid code in real Kotlin
    // (cross-checked against api.kotlinlang.org, prints "true") but the
    // validator rejected it. Following the same precedent already set at
    // interpreter.ts:119 (`!env.has('isActive')`) — the validator now carries
    // a stack of declared names (ValDecl/params/catch variable/for variable)
    // and only reports an error when the name is NOT declared in any enclosing scope.

    it('a self-declared val isActive — no diagnostic, runs for real and prints the right value', () => {
      const src = 'fun main() {\n  val isActive = true\n  println(isActive)\n}'
      expect(check(src)).toEqual([])
      expect(runSource(src).output).toEqual(['true'])
    })

    it('a bare isActive with NO declaration — HAS a diagnostic at the right line, with a hint', () => {
      const d = check('fun main() {\n  println(isActive)\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.line).toBe(2)
      expect(d[0]!.hint).toBeTruthy()
    })

    it('a self-declared val ensureActive — no diagnostic, runs for real and prints the right value', () => {
      const src = 'fun main() {\n  val ensureActive = 42\n  println(ensureActive)\n}'
      expect(check(src)).toEqual([])
      expect(runSource(src).output).toEqual(['42'])
    })

    it('ensureActive() with NO declaration — HAS a diagnostic at the right line, with a hint', () => {
      const d = check('fun main() {\n  ensureActive()\n  println("x")\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.line).toBe(2)
      expect(d[0]!.hint).toBeTruthy()
    })

    it('a variable declared INSIDE a block does NOT leak OUTSIDE that block', () => {
      // Cross-checked against real Kotlin (api.kotlinlang.org): the println
      // outside the if reports "Unresolved reference 'isActive'" — matching
      // the assertion below.
      //
      // This is a specific regression guard: if the scope stack weren't
      // properly popped (e.g. using one shared flat Set instead of one per
      // block) the name declared inside the if would "leak" outside, and this
      // case would go WRONG (no more diagnostic).
      const d = check(
        'fun main() {\n' +
        '  if (true) {\n' +
        '    val isActive = true\n' +
        '    println(isActive)\n' +
        '  }\n' +
        '  println(isActive)\n' +
        '}')
      expect(d).toHaveLength(1)
      expect(d[0]!.line).toBe(6)
    })
  })
})
