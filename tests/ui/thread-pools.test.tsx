import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreadPools } from '../../src/ui/graph/ThreadPools'
import { runSource } from '../../src/engine/run'
import { foldTrace, type WorldState } from '../../src/engine/trace/world'
import { DISPATCHER_POOL_SIZE } from '../../src/engine/runtime/dispatcher'

/**
 * The dispatcher dimension used to be entirely invisible: the engine models
 * fixed-size pools, acquire/release and a DISPATCH event per hop, and `threadId`
 * was rendered nowhere in the UI at all. These cases pin the three things the
 * strip exists to make visible.
 */
const worldAt = (src: string, step: number): WorldState => {
  const r = runSource(src)
  expect(r.diagnostics, 'fixture must compile').toEqual([])
  return foldTrace(r.events, step < 0 ? r.events.length : step)
}

const SWITCH = `import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch(Dispatchers.IO) {
        println("on IO")
        withContext(Dispatchers.Default) { println("on Default") }
        println("back on IO")
    }
    job.join()
}
`

/** The step index right after the Nth DISPATCH event, i.e. with it applied. */
const afterDispatch = (src: string, n: number): number => {
  const evs = runSource(src).events
  const idx = evs.map((e, i) => (e.k === 'DISPATCH' ? i : -1)).filter(i => i >= 0)
  expect(idx.length, `fixture has fewer than ${n + 1} DISPATCH events`).toBeGreaterThan(n)
  return idx[n]! + 1
}

describe('dispatcher pools — the strip under the graph', () => {
  it('draws EVERY slot of a pool, not just the busy ones', () => {
    // This is what makes "IO vs Default" legible: 8 boxes next to 4. Drawing
    // only the occupied threads would show one box for each and teach nothing.
    render(<ThreadPools world={worldAt(SWITCH, -1)} />)
    for (let i = 1; i <= DISPATCHER_POOL_SIZE.IO!; i++) {
      expect(screen.getByTestId(`slot-IO-${i}`), `IO-${i} missing`).toBeInTheDocument()
    }
    expect(screen.getAllByTestId(/^slot-IO-/)).toHaveLength(DISPATCHER_POOL_SIZE.IO!)
  })

  it('a busy slot names the coroutine on it; an idle one says so', () => {
    // An empty box reads as "no data", not "this thread is free".
    const world = worldAt(SWITCH, afterDispatch(SWITCH, 0))
    render(<ThreadPools world={world} />)
    expect(screen.getByTestId('slot-IO-1')).toHaveTextContent('job')
    expect(screen.getByTestId('slot-IO-2')).toHaveTextContent('idle')
  })

  it('withContext MOVES the same coroutine to the other pool, then back', () => {
    // The whole point of the user-visible complaint: the pool switch was not
    // visible anywhere. Three snapshots of one coroutine, one assertion each.
    const onIo = worldAt(SWITCH, afterDispatch(SWITCH, 0))
    expect([...onIo.jobs.values()].find(j => j.varName === 'job')?.threadId).toBe('IO-1')

    // The withContext job is a separate node but the SAME coroutine in Kotlin
    // terms; what matters is that a Default thread is now occupied and it was
    // not before.
    const onDefault = worldAt(SWITCH, afterDispatch(SWITCH, 1))
    const busyDefault = [...onDefault.jobs.values()].filter(j => j.threadId?.startsWith('Default-'))
    expect(busyDefault.length, 'nothing moved onto Default').toBeGreaterThan(0)
    render(<ThreadPools world={onDefault} />)
    expect(screen.getByTestId('slot-Default-1')).not.toHaveTextContent('idle')
  })

  it('marks the slot the coroutine JUST arrived on', () => {
    // Without this the hop is only visible as a layout that quietly changed
    // between two scrub positions.
    const world = worldAt(SWITCH, afterDispatch(SWITCH, 1))
    expect(world.lastEvent?.k).toBe('DISPATCH')
    render(<ThreadPools world={world} />)
    const arrived = document.querySelectorAll('.pools__slot--arrived')
    expect(arrived, 'no slot marked as just-arrived').toHaveLength(1)
  })

  it('a coroutine that has FINISHED does not keep occupying its slot', () => {
    // Measured before this guard existed: `JobView.threadId` is cleared on
    // COROUTINE_SUSPENDED but NOT when a job ends, so a job `Completed` at
    // t=20 still reported `IO-1` and the strip drew a dead coroutine sitting on
    // a thread. `world.threads` (from THREAD_STATE) is the authority.
    const src = `import kotlinx.coroutines.*

fun main() = runBlocking {
    launch(Dispatchers.IO) { delay(10) }
    launch(Dispatchers.IO) { delay(100) }
    delay(20)
}
`
    const r = runSource(src)
    const at = r.events.findIndex(e => e.t === 20)
    const world = foldTrace(r.events, at + 1)
    const done = [...world.jobs.values()].find(j => j.state === 'Completed')!
    expect(done.threadId, 'fixture premise: threadId really is stale after finishing').not.toBeNull()

    render(<ThreadPools world={world} />)
    expect(screen.getByTestId(`slot-${done.threadId}`)).toHaveTextContent('idle')
  })

  it('counts only coroutines that are suspended AND still alive', () => {
    // The reason a pool of four can carry twenty coroutines. The fixture has a
    // third child CANCELLED while parked in delay: `suspendReason` is sticky
    // too, so counting on it alone would report 3 instead of 2.
    const src = `import kotlinx.coroutines.*

fun main() = runBlocking {
    val doomed = launch(Dispatchers.IO) { delay(1000) }
    launch(Dispatchers.IO) { delay(500) }
    launch(Dispatchers.IO) { delay(500) }
    delay(20)
    doomed.cancel()
    delay(10)
}
`
    const r = runSource(src)
    const at = r.events.findIndex(e => e.t === 30)
    const world = foldTrace(r.events, at + 1)
    const cancelled = [...world.jobs.values()].find(j => j.state === 'Cancelled')!
    expect(cancelled.suspendReason, 'fixture premise: suspendReason survives cancellation').not.toBeNull()

    render(<ThreadPools world={world} />)
    expect(screen.getByTestId('waiting-IO')).toHaveTextContent(/2 suspended, holding no thread/)
  })

  it('only draws pools actually in play', () => {
    // Always drawing all four would put ten idle slots on screen for a program
    // that never leaves Main.
    const src = 'fun main() = runBlocking {\n    launch { println("hi") }\n}'
    render(<ThreadPools world={worldAt(src, -1)} />)
    expect(screen.getByTestId('slot-Main-1')).toBeInTheDocument()
    expect(screen.queryByTestId('slot-IO-1')).toBeNull()
    expect(screen.queryByTestId('slot-Default-1')).toBeNull()
  })

  it('renders nothing before any code has run', () => {
    const { container } = render(<ThreadPools world={foldTrace([], 0)} />)
    expect(container).toBeEmptyDOMElement()
  })
})
