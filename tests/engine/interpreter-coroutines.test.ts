import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string) => runSource(src).output

const evs = (src: string) => runSource(src).events

describe('interpreter — coroutine builders', () => {
  it('runBlocking runs its body', () => {
    expect(out('fun main() = runBlocking {\n  println("in")\n}')).toEqual(['in'])
  })

  it('launch creates a child job', () => {
    const e = evs('fun main() = runBlocking {\n  launch { println("child") }\n}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    expect(created).toHaveLength(2)
    // Event is a union discriminated by `k`; .filter() doesn't narrow the
    // element type on its own (it's not a type predicate), so it has to be
    // cast like other tests in the repo (e.g. runtime-propagation.test.ts) to
    // pass strict typechecking.
    expect(created[1]).toMatchObject({ builder: 'launch', parentId: (created[0] as { id: string }).id })
  })

  it('launch runs after the parent body yields control', () => {
    expect(out('fun main() = runBlocking {\n  launch { println("B") }\n  println("A")\n}'))
      .toEqual(['A', 'B'])
  })

  it('delay orders completion', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  launch { delay(200); println("slow") }\n' +
      '  launch { delay(100); println("fast") }\n' +
      '}')).toEqual(['fast', 'slow'])
  })

  it('coroutineScope waits for all children', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  coroutineScope { launch { delay(50); println("child") } }\n' +
      '  println("after")\n' +
      '}')).toEqual(['child', 'after'])
  })

  it('supervisorScope creates a job with isSupervisor', () => {
    const e = evs('fun main() = runBlocking {\n  supervisorScope { launch { } }\n}')
    expect(e.some(x => x.k === 'COROUTINE_CREATED' && x.ctx.isSupervisor)).toBe(true)
  })

  it('Dispatchers.IO sets the dispatcher for the coroutine', () => {
    const e = evs('fun main() = runBlocking {\n  launch(Dispatchers.IO) { delay(1) }\n}')
    expect(e.some(x => x.k === 'COROUTINE_CREATED' && x.ctx.dispatcher === 'IO')).toBe(true)
  })

  it('context + keeps both dispatcher and name, regardless of the order added', () => {
    // Old bug: '+' concatenated the className ('Dispatchers.IO+CoroutineName'),
    // and applyCtxValue then misread it, producing a dispatcher of
    // "IO+CoroutineName" with the name lost entirely. __CtxPlus keeps an
    // ordered list of elements, so both must survive, in either add order.
    const e1 = evs('fun main() = runBlocking {\n  launch(Dispatchers.IO + CoroutineName("w")) { }\n}')
    const created1 = e1.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'launch')
    expect(created1).toMatchObject({ ctx: { dispatcher: 'IO', name: 'w' } })

    const e2 = evs('fun main() = runBlocking {\n  launch(CoroutineName("w") + Dispatchers.IO) { }\n}')
    const created2 = e2.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'launch')
    expect(created2).toMatchObject({ ctx: { dispatcher: 'IO', name: 'w' } })
  })

  it('an uncaught exception in launch makes the child FAILED', () => {
    const e = evs('fun main() = runBlocking {\n  launch { throw RuntimeException("boom") }\n}')
    expect(e.some(x => x.k === 'EXCEPTION_THROWN' && x.exType === 'RuntimeException')).toBe(true)
  })

  it('a child of a failed job gets cancelled — no orphan keeps running', () => {
    // Old bug: reportFailure cancelled siblings at every ancestor level but
    // never cancelled the failed job's OWN CHILD — it just kept running and
    // printed after the parent was already Cancelled. Violates structured
    // concurrency, the foundation this tool teaches.
    const o = out(
      'fun main() = runBlocking {\n' +
      '  launch {\n' +
      '    launch { delay(1000); println("orphan") }\n' +
      '    throw RuntimeException("boom")\n' +
      '  }\n' +
      '}')
    expect(o).toEqual([])

    // SECOND PATH, same rule: the body of a coroutineScope throws. The launch
    // path above goes through step(), so it still reaches reportFailure; the
    // inline-scope path did NOT — it wrapped its body in a try/finally with no
    // catch, so the exception escaped while the scope was still reported as
    // Completed and nothing cancelled its children.
    const o2 = out(
      'fun main() = runBlocking {\n' +
      '  coroutineScope {\n' +
      '    launch { delay(1000); println("orphan") }\n' +
      '    throw RuntimeException("boom")\n' +
      '  }\n' +
      '}')
    expect(o2).toEqual([])
  })

  it('a throw inside a coroutineScope body: the scope FAILS, it is not Completed', () => {
    // Real Kotlin: coroutineScope { launch { ... }; throw } cancels every
    // child then rethrows. The old engine reported
    // Active->Completing->Completed for the scope while its child was still
    // New, and never emitted a FAILURE_PROPAGATED — the teaching tool said the
    // exact opposite of the semantics it exists to teach.
    const r = runSource(
      'fun main() = runBlocking {\n' +
      '  coroutineScope {\n' +
      '    launch { delay(1000); println("orphan") }\n' +
      '    throw RuntimeException("boom")\n' +
      '  }\n' +
      '}')
    const created = r.events.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'coroutineScope')
    const scopeId = (created as { id: string }).id

    expect(r.events.some(x => x.k === 'JOB_STATE' && x.id === scopeId && x.to === 'Completed'))
      .toBe(false)
    expect(r.events.some(x => x.k === 'JOB_STATE' && x.id === scopeId && x.to === 'Cancelled'))
      .toBe(true)
    expect(r.events.some(x => x.k === 'EXCEPTION_THROWN' && x.id === scopeId
      && x.exType === 'RuntimeException')).toBe(true)
    expect(r.events.some(x => x.k === 'FAILURE_PROPAGATED' && x.from === scopeId)).toBe(true)
  })

  it('coroutineScope rethrows the CORRECT exception from its child, not a CancellationException', () => {
    // "coroutineScope rethrows a child's exception, supervisorScope doesn't"
    // is the difference this whole milestone exists to teach. The old engine
    // let a child's failure bubble up marking the ancestor Cancelled, and then
    // unwindCancelled threw a SYNTHETIC CancellationException into the scope's
    // generator — so the learner saw "EX: Job was cancelled" where real Kotlin
    // prints "RT: boom".
    expect(out(
      'fun main() = runBlocking {\n' +
      '  try {\n' +
      '    coroutineScope { launch { delay(10); throw RuntimeException("boom") } }\n' +
      '  } catch (e: RuntimeException) {\n' +
      '    println("RT: " + e.message)\n' +
      '  } catch (e: Exception) {\n' +
      '    println("EX: " + e.message)\n' +
      '  }\n' +
      '}')).toEqual(['RT: boom'])
  })

  it('a job CANCELLED from outside still gets a CancellationException, not a sibling\'s exception', () => {
    // The flip side of the same rule, and the trap when fixing the test above:
    // a sibling dragged along by cancellation must receive a
    // CancellationException. If unwind rethrew the ORIGINAL exception into
    // every job with a `cause`, an unrelated coroutine's
    // `catch (e: RuntimeException)` would catch someone else's "boom" — flatly wrong for Kotlin.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  coroutineScope {\n' +
      '    launch {\n' +
      '      try { delay(1000) }\n' +
      '      catch (e: RuntimeException) { println("WRONG: " + e.message) }\n' +
      '      catch (e: Exception) { println("RIGHT: " + e.message) }\n' +
      '    }\n' +
      '    launch { delay(10); throw RuntimeException("boom") }\n' +
      '  }\n' +
      '}')).toEqual(['RIGHT: Job was cancelled'])
  })

  it('catching a coroutineScope\'s failure does NOT mark the enclosing job Cancelled', () => {
    // kotlinx: ScopeCoroutine returns the exception into the CALLER's
    // continuation (JobSupport.cancelParent returns early when
    // isScopedCoroutine), it does NOT cancel the parent job. The engine used
    // to let the failure bubble straight up, so the trace claimed runBlocking
    // had died while the program kept running and printing — a UI rendering
    // job state from the trace would show a Cancelled root coroutine still doing work.
    const r = runSource(
      'fun main() = runBlocking {\n' +
      '  try {\n' +
      '    coroutineScope { launch { delay(10); throw RuntimeException("boom") } }\n' +
      '  } catch (e: Exception) { println("caught " + e.message) }\n' +
      '  println("still running")\n' +
      '}')
    expect(r.output).toEqual(['caught boom', 'still running'])

    const rootId = (r.events.find(x => x.k === 'COROUTINE_CREATED') as { id: string }).id
    const rootStates = r.events
      .filter(x => x.k === 'JOB_STATE' && x.id === rootId)
      .map(x => (x as { to: string }).to)
    expect(rootStates).toEqual(['Active', 'Completing', 'Completed'])
    expect(r.events.some(x => x.k === 'CANCEL_REQUESTED' && x.to === rootId)).toBe(false)
  })

  it('a coroutineScope failure does NOT drag down siblings OUTSIDE the scope once the failure is caught', () => {
    // An observable consequence of the same rule: a scope doesn't cancel the
    // parent job, so the parent's other children are untouched. If the
    // failure still bubbled up to the parent, cancelJob would sweep every
    // sibling and "the parallel one is still alive" would never print.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  launch { delay(200); println("parallel still alive") }\n' +
      '  try {\n' +
      '    coroutineScope { launch { delay(10); throw RuntimeException("boom") } }\n' +
      '  } catch (e: Exception) { println("caught") }\n' +
      '}')).toEqual(['caught', 'parallel still alive'])
  })

  it('supervisorScope does NOT rethrow a child\'s failure — unlike coroutineScope', () => {
    // The flip side of the same rule, and the trap when implementing "a scope
    // rethrows": only coroutineScope/withContext return a child's failure to
    // the caller. supervisorScope blocks it right at its boundary, so the
    // caller sees nothing at all.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  try {\n' +
      '    supervisorScope { launch { delay(10); throw RuntimeException("boom") } }\n' +
      '  } catch (e: Exception) { println("SHOULD NOT BE CAUGHT: " + e.message) }\n' +
      '  println("done")\n' +
      '}')).toEqual(['done'])
  })

  it('EXCEPTION_THROWN must NOT be emitted for a job already in a terminal state', () => {
    // failInline correctly guards with `if (job.isCompleted) return`, but
    // step()'s catch block did not, and run.ts unwraps the root runBlocking
    // layer, so the root job goes through exactly the path that wasn't
    // guarded. Result: the same exception got recorded twice, the second time
    // for a job the trace had just declared dead — a UI rendering from the
    // trace would show a Cancelled job still throwing an exception.
    //
    // Asserted as an INVARIANT, not an event count: asserting "exactly one
    // EXCEPTION_THROWN" would break the moment the scope semantics get fixed,
    // since at that point the escaping exception genuinely passes through two
    // different coroutine frames.
    const r = runSource(
      'fun main() = runBlocking {\n' +
      '  coroutineScope {\n' +
      '    launch { delay(1000); println("orphan") }\n' +
      '    throw RuntimeException("boom")\n' +
      '  }\n' +
      '}')
    const dead = new Set<string>()
    const offenders: string[] = []
    for (const e of r.events) {
      if (e.k === 'JOB_STATE' && (e.to === 'Completed' || e.to === 'Cancelled')) dead.add(e.id)
      if (e.k === 'EXCEPTION_THROWN' && dead.has(e.id)) offenders.push(`${e.seq}:${e.id}`)
    }
    expect(offenders).toEqual([])
  })

  it('cancelling a job emits CANCEL_REQUESTED', () => {
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(1000) }\n' +
      '  j.cancel()\n' +
      '}')
    expect(e.some(x => x.k === 'CANCEL_REQUESTED')).toBe(true)
  })

  it('launch after a suspend point INSIDE coroutineScope attaches to the right scope, not to root', () => {
    // Distinguishes env.enclosingJobId from Scheduler.currentJob. The delay
    // MUST come before the launch: currentJob is reset on every step(), so
    // after resuming it points at the job of whatever task is currently
    // running (root), while the lexical scope is still coroutineScope.
    // Without a suspend point, the two values coincide and the test can't tell them apart.
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  coroutineScope {\n' +
      '    delay(10)\n' +
      '    launch { delay(1) }\n' +
      '  }\n' +
      '}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    const scope = created.find(x => (x as { builder: string }).builder === 'coroutineScope')!
    const launched = created.find(x => (x as { builder: string }).builder === 'launch')!
    expect((launched as { parentId: string }).parentId).toBe((scope as { id: string }).id)
  })

  it('GlobalScope.launch ESCAPES the job tree — it does not attach to the enclosing scope', () => {
    // "GlobalScope escapes the job tree" is one of the lessons this tool
    // exists to teach, so it MUST be distinguishable from a plain launch. The
    // old engine ignored the receiver of a member call, so
    // GlobalScope.launch attached to the lexically enclosing job — exactly
    // like a plain launch, with nothing left to teach.
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  GlobalScope.launch { delay(1) }\n' +
      '  launch { delay(1) }\n' +
      '}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED' && x.builder === 'launch')
    expect(created).toHaveLength(2)
    expect((created[0] as { parentId: string | null }).parentId).toBeNull()
    expect((created[1] as { parentId: string | null }).parentId).not.toBeNull()
  })

  it('GlobalScope.launch is NOT cancelled through the tree — the core difference from a plain launch', () => {
    // An observable consequence of escaping the tree: cancelling the
    // enclosing job drags along a plain launch but does NOT touch the
    // GlobalScope coroutine.
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  val p = launch {\n' +
      '    GlobalScope.launch { delay(1000) }\n' +
      '    launch { delay(1000) }\n' +
      '    delay(1000)\n' +
      '  }\n' +
      '  delay(10)\n' +
      '  p.cancel()\n' +
      '}')
    const globalId = (e.find(x => x.k === 'COROUTINE_CREATED' && x.parentId === null
      && x.builder === 'launch') as { id: string } | undefined)?.id
    expect(globalId).toBeTruthy()
    expect(e.some(x => x.k === 'CANCEL_REQUESTED' && x.to === globalId)).toBe(false)
  })

  it('GlobalScope.launch DIES when runBlocking finishes — like a JVM exit', () => {
    // The other side of "escapes the tree": escaping doesn't mean it gets to
    // outlive the program either. The real JVM runs GlobalScope coroutines on
    // a daemon thread, so when `main` returns they're killed immediately,
    // with no chance to print. runToCompletion drains EVERY timer, so the
    // engine used to let them keep printing after the program had already
    // finished — teaching the second half of the lesson backwards.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  GlobalScope.launch { delay(100); println("should not print") }\n' +
      '  println("main done")\n' +
      '}')).toEqual(['main done'])
  })

  it('an abandoned GlobalScope coroutine shows up clearly on the trace: parked at suspend, no terminal state', () => {
    // "Dies at exit" must be VISIBLE, not silently vanish. The engine
    // deliberately does NOT fabricate a synthetic cancel for it: the real JVM
    // kills the daemon thread without unwinding, so emitting
    // CANCEL_REQUESTED/Cancelled would make its `finally` run — wrong in a
    // different way. The trace leaves it sitting exactly at
    // COROUTINE_SUSPENDED with no resume: exactly what actually happened.
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  GlobalScope.launch { delay(100); println("should not print") }\n' +
      '  println("main done")\n' +
      '}')
    const globalId = (e.find(x => x.k === 'COROUTINE_CREATED' && x.parentId === null
      && x.builder === 'launch') as { id: string } | undefined)?.id
    expect(globalId).toBeTruthy()
    expect(e.some(x => x.k === 'COROUTINE_STARTED' && x.id === globalId)).toBe(true)
    expect(e.some(x => x.k === 'COROUTINE_SUSPENDED' && x.id === globalId)).toBe(true)
    expect(e.some(x => x.k === 'COROUTINE_RESUMED' && x.id === globalId)).toBe(false)
    expect(e.some(x => x.k === 'JOB_STATE' && x.id === globalId
      && (x.to === 'Completed' || x.to === 'Cancelled'))).toBe(false)
  })

  it('CoroutineScope(ctx).launch uses the scope\'s dispatcher, doesn\'t drop it', () => {
    // `parentId` used to be asserted as null here. WRONG relative to real
    // Kotlin, and Task 5 (M3) fixed it: `CoroutineScope(ctx) =
    // ContextScope(if (ctx[Job] != null) ctx else ctx + Job())` — even a
    // context WITHOUT a Job, like `Dispatchers.Default`, gets handed a fresh
    // Job(). Cross-checked against the real compiler:
    // `CoroutineScope(Dispatchers.Default).coroutineContext[Job]` prints
    // `JobImpl{Active}`, and `job.parent === scope.coroutineContext[Job]` is
    // true. The parent is the scope's ROOT Job, not null, and not the
    // enclosing runBlocking either.
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  val scope = CoroutineScope(Dispatchers.Default)\n' +
      '  scope.launch { delay(1) }\n' +
      '}')
    const root = e.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'scope')
    expect(root).toMatchObject({ parentId: null, ctx: { isSupervisor: false } })
    const launched = e.find(x => x.k === 'COROUTINE_CREATED' && x.builder === 'launch')
    expect(launched).toMatchObject({
      parentId: (root as { id: string }).id, ctx: { dispatcher: 'Default' },
    })
  })

  it('launch inside a suspend fun attaches to the caller\'s correct coroutine scope', () => {
    // Closes a gap left by Task 15: callFun passes env.enclosingJobId into the
    // scope of the function body, but Task 15 had no builder yet, so dropping
    // that parameter didn't turn any test red. Now that launch exists, it can be checked.
    const e = evs(
      'suspend fun work(scope: CoroutineScope) {\n' +
      '  scope.launch { delay(1) }\n' +
      '}\n' +
      'fun main() = runBlocking {\n  work(this)\n}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    // The coroutine created by launch inside the suspend fun must have a parentId, not a loose root.
    expect(created.length).toBeGreaterThanOrEqual(2)
    expect((created[created.length - 1] as { parentId: string | null }).parentId).not.toBeNull()
  })

  it('finally runs when a coroutine finishes NORMALLY', () => {
    // This test used to be named "finally still runs when a coroutine is
    // cancelled" but its body does NOT call .cancel() at all — it just runs
    // to completion normally. The actual cancel case is covered by Task 18;
    // as of Task 16 it still didn't work.
    const o = out(
      'fun main() = runBlocking {\n' +
      '  try { delay(10); println("done") } finally { println("cleanup") }\n' +
      '}')
    expect(o).toEqual(['done', 'cleanup'])
  })
})
