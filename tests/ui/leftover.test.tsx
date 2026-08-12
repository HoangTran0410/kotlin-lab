import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { unfinishedCoroutines } from '../../src/engine/trace/leftover'
import { runSource } from '../../src/engine/run'

/**
 * A real case users run into: the program has no `runBlocking`, so `main`
 * returns immediately and every coroutine that was just launched is left
 * behind at `delay`. Empty output, a graph full of nodes standing still, NOT
 * A WORD about why.
 *
 * Real Kotlin also produces empty output for this exact program (cross-checked
 * against the 2.1.20 playground) — so the engine isn't wrong. What's wrong is
 * the silence.
 */
const NO_RUN_BLOCKING = `import kotlinx.coroutines.*

fun main() {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch {
        launch { delay(500); throw RuntimeException("Child 1 failed") }
        launch { delay(1000); println("Child 2 finished") }
    }
}
`

const load = (src: string): void => {
  act(() => { useLabStore.getState().loadSource(src) })
}

describe('coroutines left unfinished', () => {
  beforeEach(() => {
    // `loadSource('')`, not `setState({ source: '' })`: the store is a module
    // variable shared across the whole file, and setState does NOT
    // recompile — so the previous case's `compiled` would still be around,
    // and the last case would get globalscope's trace instead. Measured: it
    // fails red for exactly that reason.
    act(() => { useLabStore.getState().loadSource('') })
  })

  it('picks up exactly the unfinished jobs, not jobs that already completed', () => {
    const r = runSource(NO_RUN_BLOCKING)
    expect(r.diagnostics).toEqual([])
    expect(r.output, 'this program cannot print anything — just like the real JVM').toEqual([])
    const { jobs } = unfinishedCoroutines(r.events)
    // Four unfinished ones: the scope's root job, the parent launch, and its
    // two child launches. The root runBlocking has Completed, so it must NOT
    // be present.
    expect(jobs).toHaveLength(4)
    expect(jobs.every(j => j.state !== 'Completed' && j.state !== 'Cancelled')).toBe(true)
    expect(jobs.some(j => j.builder === 'runBlocking'), 'a completed job got counted as unfinished').toBe(false)
  })

  it('shows the notice, with a runBlocking hint, when the file has no runBlocking at all', () => {
    render(<App />)
    load(NO_RUN_BLOCKING)
    const note = screen.getByTestId('leftover-notice')
    expect(note).toHaveTextContent('4 coroutine(s) left unfinished')
    expect(note).toHaveTextContent(/no .*runBlocking.* in the file/i)
  })

  it('does NOT show when every coroutine ran to completion', () => {
    // If the notice showed even in the normal case, it would become noise and
    // people would learn to ignore it — right when it's needed, it wouldn't
    // get read anymore.
    render(<App />)
    load(lessonSource('suspend')!)
    expect(screen.queryByTestId('leftover-notice')).toBeNull()
  })

  it('still shows when runBlocking IS present, but no longer mentions runBlocking', () => {
    // GlobalScope: runBlocking is present, and the program still leaves one
    // coroutine behind. A "add runBlocking" hint here would be bad advice.
    render(<App />)
    load(lessonSource('globalscope')!)
    const note = screen.getByTestId('leftover-notice')
    expect(note).toHaveTextContent('1 coroutine(s) left unfinished')
    expect(note.textContent).not.toMatch(/no .*runBlocking.* in the file/i)
  })

  it('shows nothing when there is no code yet', () => {
    render(<App />)
    expect(screen.queryByTestId('leftover-notice')).toBeNull()
  })
})
