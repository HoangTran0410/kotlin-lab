import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { DISPATCHER_POOL_SIZE, DispatcherPool } from '../../src/engine/runtime/dispatcher'

describe('honest validation', () => {
  it('rejects unsupported Flow code instead of executing it as Unit', () => {
    const r = runSource(`fun main() = runBlocking {
    flowOf(1, 2).collect { println(it) }
    println("after")
}`)
    expect(r.diagnostics.some(d => d.message.includes('flowOf'))).toBe(true)
    expect(r.diagnostics.some(d => d.message.includes('collect'))).toBe(true)
    expect(r.events).toEqual([])
    expect(r.output).toEqual([])
  })

  it('rejects a misspelled call instead of silently returning Unit', () => {
    const r = runSource(`fun main() = runBlocking {
    laucnch { println("must not run") }
}`)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]!.message).toContain('laucnch')
    expect(r.events).toEqual([])
  })

  it('rejects calling a local value because local function invocation is not modeled', () => {
    const r = runSource(`fun main() = runBlocking {
    val f = { println("must not run") }
    f()
}`)
    expect(r.diagnostics.some(d => d.message.includes("'f'"))).toBe(true)
    expect(r.events).toEqual([])
  })

  it('rejects an impossible coroutine receiver instead of treating it as a bare launch', () => {
    const r = runSource(`fun main() = runBlocking {
    1.launch { println("must not run") }
}`)
    expect(r.diagnostics.some(d => d.message.includes('receiver'))).toBe(true)
    expect(r.events).toEqual([])
  })

  it.each([
    'val x = 1\n    x.launch { println("must not run") }',
    'CoroutineName("not a scope").launch { println("must not run") }',
  ])('rejects non-scope launch receivers: %s', body => {
    const r = runSource(`fun main() = runBlocking {
    ${body}
}`)
    expect(r.diagnostics.some(d => d.message.includes('receiver'))).toBe(true)
    expect(r.events).toEqual([])
  })

  it('rejects an uppercase misspelling instead of treating it as a constructor', () => {
    const r = runSource(`fun main() = runBlocking {
    Laucnch { println("must not run") }
}`)
    expect(r.diagnostics.some(d => d.message.includes('Laucnch'))).toBe(true)
    expect(r.events).toEqual([])
  })

  it.each(['join()', 'await()', 'delay(1)', 'cancel()', 'cancelAndJoin()'])(
    'rejects a non-coroutine receiver for member call %s',
    call => {
      const r = runSource(`fun main() = runBlocking {
    val x = 1
    x.${call}
}`)
      expect(r.diagnostics.some(d => d.message.includes('receiver'))).toBe(true)
      expect(r.events).toEqual([])
    },
  )

  it.each(['join()', 'await()', 'cancelAndJoin()'])(
    'rejects member-only coroutine operation used as a bare call: %s',
    call => {
      const r = runSource(`fun main() = runBlocking {
    ${call}
    println("must not run")
}`)
      expect(r.diagnostics.some(d => d.message.includes('receiver'))).toBe(true)
      expect(r.events).toEqual([])
      expect(r.output).toEqual([])
    },
  )

  it.each(['DEFAULT', 'LAZY', 'ATOMIC', 'UNDISPATCHED'])(
    'rejects explicit CoroutineStart.%s until that mode is modeled',
    mode => {
      const r = runSource(`fun main() = runBlocking {
    launch(start = CoroutineStart.${mode}) { println("must not run") }
}`)
      expect(r.diagnostics.some(d => d.message.includes('CoroutineStart'))).toBe(true)
      expect(r.events).toEqual([])
    },
  )
})

describe('withTimeout / withTimeoutOrNull', () => {
  it('uses virtual time and lets a block complete before its deadline', () => {
    const r = runSource(`fun main() = runBlocking {
    withTimeout(100) {
        delay(40)
        println("completed")
    }
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['completed'])
    expect(r.events.at(-1)!.t).toBe(40)
  })

  it('throws TimeoutCancellationException at a suspension point', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        withTimeout(50) {
            delay(100)
            println("too late")
        }
    } catch (e: TimeoutCancellationException) {
        println("timed out")
    }
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['timed out'])
    expect(r.events.some(e => e.k === 'CANCEL_REQUESTED' && e.cause === 'TimeoutCancellationException')).toBe(true)
  })

  it('cancels and joins children before the timeout escapes', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        withTimeout(50) {
            launch {
                try { delay(1000) } finally { println("child cleanup") }
            }
            delay(1000)
        }
    } catch (e: TimeoutCancellationException) {
        println("timeout caught")
    }
}`)
    expect(r.output).toEqual(['child cleanup', 'timeout caught'])
  })

  it('returns null on timeout, while preserving a successful result', () => {
    const r = runSource(`fun main() = runBlocking {
    val timedOut = withTimeoutOrNull(10) { delay(20); 1 }
    val completed = withTimeoutOrNull(20) { delay(5); 7 }
    println(timedOut)
    println(completed)
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['null', '7'])
  })

  it('a non-positive timeout does not execute its block', () => {
    const r = runSource(`fun main() = runBlocking {
    val x = withTimeoutOrNull(0) { println("must not run"); 1 }
    println(x)
    try {
        withTimeout(-1) { println("also must not run") }
    } catch (e: TimeoutCancellationException) {
        println("immediate")
    }
}`)
    expect(r.output).toEqual(['null', 'immediate'])
  })

  it('withTimeoutOrNull does not swallow a nested timeout', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        withTimeoutOrNull(1000) {
            withTimeout(10) { delay(20) }
            println("must not run")
        }
    } catch (e: TimeoutCancellationException) {
        println("inner timeout escaped")
    }
}`)
    expect(r.output).toEqual(['inner timeout escaped'])
  })

  it('withTimeoutOrNull does not turn external cancellation into null', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        val result = withTimeoutOrNull(1000) { delay(2000); 7 }
        println("wrong: " + result)
    }
    delay(10)
    job.cancelAndJoin()
    println("done")
}`)
    expect(r.output).toEqual(['done'])
  })

  it('the timeout wins when a delay resumes exactly at the deadline', () => {
    const r = runSource(`fun main() = runBlocking {
    println(withTimeoutOrNull(10) { delay(10); 7 })
}`)
    expect(r.output).toEqual(['null'])
  })

  it('times out while waiting for a delayed child after the body returns', () => {
    const r = runSource(`fun main() = runBlocking {
    val result = withTimeoutOrNull(10) {
        launch { delay(20) }
        7
    }
    println(result)
}`)
    expect(r.output).toEqual(['null'])
  })

  it('preserves timeout ownership when the timeout is caught and rethrown', () => {
    const r = runSource(`fun main() = runBlocking {
    val result = withTimeoutOrNull(10) {
        try { delay(20) }
        catch (e: TimeoutCancellationException) { throw e }
    }
    println(result)
}`)
    expect(r.output).toEqual(['null'])
  })

  it('lets a cleanup failure replace an in-flight timeout cancellation', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        withTimeoutOrNull(10) {
            try { delay(20) }
            finally { throw IllegalStateException("cleanup failed") }
        }
    } catch (e: IllegalStateException) {
        println(e.message)
    }
}`)
    expect(r.output).toEqual(['cleanup failed'])
  })
})

describe('NonCancellable cleanup', () => {
  it('allows suspending cleanup in finally after cancellation', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try { delay(1000) }
        finally {
            withContext(NonCancellable) {
                delay(25)
                println("cleanup complete")
            }
        }
    }
    delay(10)
    job.cancelAndJoin()
    println("joined")
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['cleanup complete', 'joined'])
  })

  it.each(['launch', 'async'])(
    'rejects %s(NonCancellable), which is not a supported context form',
    builder => {
      const r = runSource(`fun main() = runBlocking {
    ${builder}(NonCancellable) { println("must not run") }
}`)
      expect(r.diagnostics.some(d => d.message.includes('NonCancellable'))).toBe(true)
      expect(r.events).toEqual([])
    },
  )

  it.each([
    'CoroutineScope(NonCancellable)',
    'runBlocking(NonCancellable) { println("must not run") }',
    'println(NonCancellable)',
  ])('rejects NonCancellable outside withContext: %s', expression => {
    const r = runSource(`fun main() = runBlocking {
    ${expression}
}`)
    expect(r.diagnostics.some(d => d.message.includes('NonCancellable'))).toBe(true)
    expect(r.events).toEqual([])
  })

  it('does not hide an exception thrown by NonCancellable cleanup', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        withTimeout(10) {
            try { delay(20) }
            finally {
                withContext(NonCancellable) {
                    delay(5)
                    throw IllegalStateException("cleanup failed")
                }
            }
        }
    } catch (e: IllegalStateException) {
        println(e.message)
    }
}`)
    expect(r.output).toEqual(['cleanup failed'])
  })

  it('reports a non-cancellation exception that replaces cancellation during unwind', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println(e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    val job = scope.launch {
        try { delay(100) }
        finally { throw IllegalStateException("cleanup replaced cancellation") }
    }
    delay(10)
    job.cancel()
    delay(10)
}`)
    expect(r.output).toEqual(['cleanup replaced cancellation'])
  })

  it('masks cancellation that arrives while NonCancellable cleanup is active', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try { delay(10) }
        finally {
            withContext(NonCancellable) {
                println("cleanup started")
                delay(50)
                println("cleanup finished")
            }
        }
    }
    delay(20)
    job.cancelAndJoin()
    println("joined")
}`)
    expect(r.output).toEqual(['cleanup started', 'cleanup finished', 'joined'])
  })
})

describe('CoroutineExceptionHandler', () => {
  it('handles an uncaught launch failure stopped by a supervisor boundary', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("caught: " + e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.launch { throw RuntimeException("boom") }
    delay(10)
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['caught: boom'])
    expect(r.events.filter(e => e.k === 'HANDLER_RECEIVED' && e.handler === 'CEH'
      && e.exType === 'RuntimeException')).toHaveLength(1)
    const child = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')
    const childId = child && 'id' in child ? child.id : ''
    expect(r.events.some(e => e.k === 'JOB_STATE' && e.id === childId && e.to === 'Cancelled')).toBe(true)
  })

  it('does not invoke a child handler when failure propagates to a regular parent', () => {
    const r = runSource(`fun main() = runBlocking {
    val childHandler = CoroutineExceptionHandler { _, e -> println("wrong: " + e.message) }
    launch(childHandler) { throw RuntimeException("boom") }
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'HANDLER_RECEIVED' && e.handler === 'CEH')).toBe(false)
  })

  it('does not invoke a handler for async failures', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("wrong: " + e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.async { throw RuntimeException("boom") }
    delay(10)
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'HANDLER_RECEIVED' && e.handler === 'CEH')).toBe(false)
  })

  it('does not invoke a handler for a root async in a regular Job scope', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("wrong: " + e.message) }
    val scope = CoroutineScope(Job() + handler)
    scope.async { throw RuntimeException("boom") }
    delay(10)
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'HANDLER_RECEIVED' && e.handler === 'CEH')).toBe(false)
  })

  it('does not invoke a handler when a launch failure is captured by an enclosing async', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("wrong: " + e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.async { launch { throw RuntimeException("boom") } }
    delay(10)
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'HANDLER_RECEIVED' && e.handler === 'CEH')).toBe(false)
  })

  it('waits for cancelled sibling cleanup before invoking the handler', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("handled") }
    val scope = CoroutineScope(Job() + handler)
    scope.launch { delay(10); throw RuntimeException("boom") }
    scope.launch {
        try { delay(100) }
        finally { println("cleanup") }
    }
    delay(200)
}`)
    expect(r.output).toEqual(['cleanup', 'handled'])
  })

  it('delivers only the primary failure when a cancelled sibling cleanup also throws', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("handled: " + e.message) }
    val scope = CoroutineScope(Job() + handler)
    scope.launch { delay(10); throw RuntimeException("primary") }
    scope.launch {
        try { delay(100) }
        finally { throw IllegalStateException("secondary") }
    }
    delay(200)
}`)
    expect(r.output).toEqual(['handled: primary'])
    expect(r.events.filter(e => e.k === 'HANDLER_RECEIVED')).toHaveLength(1)
  })

  it('delivers a launch failure even when the failing descendant is async', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("handled: " + e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.launch { async { throw RuntimeException("boom") } }
    delay(10)
}`)
    expect(r.output).toEqual(['handled: boom'])
    expect(r.events.filter(e => e.k === 'HANDLER_RECEIVED')).toHaveLength(1)
  })

  it('does not invoke a handler for a caught exception or cancellation', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("wrong: " + e.message) }
    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.launch {
        try { throw RuntimeException("caught") }
        catch (e: RuntimeException) { println(e.message) }
    }
    val cancelled = scope.launch { delay(1000) }
    delay(10)
    cancelled.cancel()
    delay(10)
}`)
    expect(r.output).toEqual(['caught'])
    expect(r.events.some(e => e.k === 'HANDLER_RECEIVED' && e.handler === 'CEH')).toBe(false)
  })

  it('rejects suspending handler bodies the simulator cannot model honestly', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> delay(1) }
    val scope = CoroutineScope(SupervisorJob() + handler)
}`)
    expect(r.diagnostics.some(d => d.message.includes('CoroutineExceptionHandler'))).toBe(true)
  })

  it('rejects an indirect suspending call from a handler', () => {
    const r = runSource(`suspend fun cleanup() { delay(1) }

fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> cleanup() }
    val scope = CoroutineScope(SupervisorJob() + handler)
}`)
    expect(r.diagnostics.some(d => d.message.includes('CoroutineExceptionHandler'))).toBe(true)
    expect(r.events).toEqual([])
  })

  it('rejects transitive handler suspension through a non-suspend wrapper', () => {
    const r = runSource(`fun wrapper() { runBlocking { delay(1) } }

fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> wrapper() }
    val scope = CoroutineScope(SupervisorJob() + handler)
}`)
    expect(r.diagnostics.some(d => d.message.includes('CoroutineExceptionHandler'))).toBe(true)
    expect(r.events).toEqual([])
  })

  it('rejects throwing handler bodies instead of letting them escape runSource', () => {
    const r = runSource(`fun main() = runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> throw IllegalStateException("handler failed") }
    val scope = CoroutineScope(SupervisorJob() + handler)
}`)
    expect(r.diagnostics.some(d => d.message.includes('CoroutineExceptionHandler'))).toBe(true)
    expect(r.events).toEqual([])
  })
})

describe('Unconfined deterministic approximation', () => {
  it('is modeled as a carrier, not a dedicated one-thread pool', () => {
    expect(DISPATCHER_POOL_SIZE.Unconfined).toBe(0)
    const pool = new DispatcherPool()
    expect(pool.acquire('Unconfined', 'j1')).toBe('Unconfined-carrier')
  })
})
