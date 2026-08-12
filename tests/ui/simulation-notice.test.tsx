import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { Shell } from '../../src/ui/layout/Shell'
import { useLabStore } from '../../src/state/store'

// Shell requires all 5 ReactNode regions; the tests below only care about
// SimulationNotice, so they pass empty placeholders for the rest.
const shellProps = { debugOpen: true, nav: null, editor: null, graph: null, timeline: null, side: null }

describe('simulation notice — permanent', () => {
  it('shows immediately when the app opens', () => {
    render(<App />)
    expect(screen.getByRole('note')).toHaveTextContent(/deterministic/i)
  })

  it('states plainly that real Kotlin can interleave differently', () => {
    render(<App />)
    expect(screen.getByRole('note')).toHaveTextContent(/interleave differently/)
  })

  it('has NO close button — not being dismissible is intentional', () => {
    render(<App />)
    const notice = screen.getByRole('note')
    expect(notice.querySelector('button')).toBeNull()
  })

  it('clicking the notice does NOT make it disappear', () => {
    // The other three tests only check at mount time. Verified: turning the
    // notice dismissible (useState(false) + onClick) still keeps all 298
    // other tests green, because the initial state doesn't change.
    // "Permanent" has to be enforced right here.
    render(<Shell {...shellProps} />)
    fireEvent.click(screen.getByRole('note'))
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  it('the notice contains no close button at all', () => {
    render(<Shell {...shellProps} />)
    const note = screen.getByRole('note')
    expect(within(note).queryByRole('button')).toBeNull()
  })

  it('the notice survives changing lessons and scrubbing the timeline', () => {
    // Guards against conditionally rendering it based on the state store.
    render(<Shell {...shellProps} />)
    act(() => { useLabStore.getState().loadLesson('supervisor') })
    act(() => { useLabStore.getState().setStep(5) })
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})
