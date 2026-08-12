import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string) => runSource(src).output

describe('cancel triggers coroutine body unwind', () => {
  // IMPORTANT NOTE: `launch` does NOT run synchronously, exactly like real
  // Kotlin. `launch { }` followed immediately by `j.cancel()` cancels it
  // BEFORE the coroutine gets a chance to start — real Kotlin doesn't print
  // anything either, because there's nothing to unwind.
  // To test unwinding, you have to `yield()` first so it runs to a suspend point.

  it('cancel BEFORE the coroutine gets to run means no finally runs — matches real Kotlin', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("not-run") } }\n' +
      '  j.cancel()\n' +
      '}')).toEqual([])
  })

  it('finally runs when cancel happens while the coroutine IS suspended', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000); println("done") } finally { println("cleanup") } }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '}')).toEqual(['cleanup'])
  })

  it('code after the suspend point does NOT run when cancelled', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(1000); println("not-printed") }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '}')).toEqual([])
  })

  it('nested finally blocks run from inside out', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch {\n' +
      '    try {\n' +
      '      try { delay(1000) } finally { println("inner") }\n' +
      '    } finally { println("outer") }\n' +
      '  }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '}')).toEqual(['inner', 'outer'])
  })

  it("cancelling the parent runs the child's finally", () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val p = launch {\n' +
      '    launch { try { delay(1000) } finally { println("child cleanup") } }\n' +
      '    delay(1000)\n' +
      '  }\n' +
      '  delay(1)\n' +
      '  p.cancel()\n' +
      '}')).toEqual(['child cleanup'])
  })

  it('join() waits until the cancelled job has FINISHED UNWINDING before returning', () => {
    // The exact opposite of the async test below: there, nobody waits; here,
    // there's a join(). Bug: cancelJob flips Active->Cancelling->Cancelled
    // straight through in ONE call, so no job ever RESTS at Cancelling;
    // sweepWaiters only looks at state and wakes the waiter immediately,
    // BEFORE the cancelled job's finally has had a chance to run. Kotlin
    // gives ["cleanup", "done"], the engine gave ["done", "cleanup"].
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("cleanup") } }\n' +
      '  delay(50)\n' +
      '  j.cancel()\n' +
      '  j.join()\n' +
      '  println("done")\n' +
      '}')).toEqual(['cleanup', 'done'])
  })

  it('cancelAndJoin() cancels THEN WAITS — it is not an alias for cancel()', () => {
    // cancelAndJoin used to be wired straight into the cancel branch and
    // silently skipped the join, so it produced exactly the wrong order that
    // learners use it to avoid.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("cleanup") } }\n' +
      '  delay(50)\n' +
      '  j.cancelAndJoin()\n' +
      '  println("done")\n' +
      '}')).toEqual(['cleanup', 'done'])
  })

  it("catch around coroutineScope runs AFTER the cancelled sibling's finally", () => {
    // Kotlin: coroutineScope doesn't re-throw until EVERY child has finished
    // unwinding, so ["cleanup A", "caught boom"]. The engine used to give
    // the opposite: a child's failure propagating up marked the runBlocking
    // job itself as Cancelled, and unwindCancelled walks taskOrder — i.e.
    // creation order, shallowest first — so the ancestor got thrown into
    // (running its catch) before the descendants had a chance to run their
    // finally.
    expect(out(
      'fun main() = runBlocking {\n' +
      '    try {\n' +
      '        coroutineScope {\n' +
      '            launch { try { delay(1000) } finally { println("cleanup A") } }\n' +
      '            launch { delay(10); throw RuntimeException("boom") }\n' +
      '        }\n' +
      '    } catch (e: Exception) { println("caught " + e.message) }\n' +
      '}')).toEqual(['cleanup A', 'caught boom'])
  })

  it('the coroutineScope BODY itself throwing must also wait for children to finish unwinding before throwing out', () => {
    // The second path of the same rule. Above, the exception comes FROM a
    // child, so it goes through reportFailure; here, the scope's own body
    // throws, so it goes through failInline. Fixing only the path above
    // would still leave this one giving ["caught boom", "cleanup A"].
    expect(out(
      'fun main() = runBlocking {\n' +
      '  try {\n' +
      '    coroutineScope {\n' +
      '      launch { try { delay(1000) } finally { println("cleanup A") } }\n' +
      '      delay(10)\n' +
      '      throw RuntimeException("boom")\n' +
      '    }\n' +
      '  } catch (e: Exception) { println("caught " + e.message) }\n' +
      '}')).toEqual(['cleanup A', 'caught boom'])
  })

  it('root FAILING still lets its child finish running finally before the program stops', () => {
    // The trap in stopping the loop when root ends (the "JVM exits" gate):
    // when root FAILS, its task gets marked finished right inside step()
    // while a child that was just cancelled hasn't unwound yet. Placing the
    // gate earlier than unwindCancelled would swallow the child's `finally`
    // — in Kotlin, runBlocking waits for the child to finish unwinding
    // before throwing out.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  launch { try { delay(1000) } finally { println("cleanup") } }\n' +
      '  delay(10)\n' +
      '  throw RuntimeException("x")\n' +
      '}')).toEqual(['cleanup'])
  })

  it('cancel() is ASYNCHRONOUS — the statement after it runs before finally', () => {
    // This is a real Kotlin trap, worth teaching. `cancel()` only REQUESTS
    // cancellation and returns immediately; `println("after cancel")` runs
    // right away, while the cancelled coroutine's finally only runs once
    // it's resumed to unwind. Getting the reverse order requires
    // cancelAndJoin() — not supported yet in M1.
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("cleanup done") } }\n' +
      '  yield()\n' +
      '  j.cancel()\n' +
      '  println("after cancel")\n' +
      '}')).toEqual(['after cancel', 'cleanup done'])
  })
})
