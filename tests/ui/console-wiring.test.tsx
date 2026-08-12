import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { openDebug } from './helpers/openDebug'

/**
 * "Wiring" per Task 8/9/10/16/17: tests that render ConsolePanel DIRECTLY
 * (console.test.tsx) can't catch bugs like "App forgot to mount
 * ConsolePanel", "App passed the wrong `stepIndex`" (e.g. hardcoding
 * compiled.events.length instead of reading the real store, so the console
 * always shows the WHOLE trace regardless of scrub position — exactly the
 * class of bug this task's red-check #1 targets). Only here, with a real
 * assembled <App/> and the real store, does that class of bug surface.
 */
describe("App wiring -> ConsolePanel — the real console follows the store's real stepIndex", () => {
  // 'A done' / 'C done' are println output from the
  // 'supervisor' lesson fixture (src/lessons/*), outside this agent's scope
  // — the lessons agent owns and translates that content separately. Left
  // as-is; integrator must update these two literals to match once the
  // lesson translation lands.
  it('scrubbing through the real store updates the real console, correct empty state at start and full at the final step', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()

    const region = screen.getByRole('region', { name: 'Console' })
    expect(within(region).getByText('No output yet.')).toBeInTheDocument()

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'the supervisor fixture needs enough events for this test to mean anything').toBeGreaterThan(0)

    act(() => { useLabStore.getState().setStep(total) })
    expect(within(region).getByText('A done')).toBeInTheDocument()
    expect(within(region).getByText('C done')).toBeInTheDocument()

    // Scrub backwards through the real store (not a manual prop rerender) —
    // the lines must disappear; this is exactly the central invariant
    // red-check #1 verifies.
    act(() => { useLabStore.getState().setStep(0) })
    expect(within(region).getByText('No output yet.')).toBeInTheDocument()
    expect(within(region).queryByText('A done')).not.toBeInTheDocument()
  })
})
