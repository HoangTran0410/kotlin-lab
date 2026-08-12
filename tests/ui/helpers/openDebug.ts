import { fireEvent, screen } from '@testing-library/react'

/**
 * Opens the debug panel (console + diagnostics + full narration + per-event
 * timeline).
 *
 * This panel defaults to CLOSED ever since the graph started carrying its own
 * explanation and scrub control — learners don't have to look at four corners
 * of the screen to understand what's happening. Any test that checks those
 * panels directly has to open it first, and having to call this function is
 * exactly the proof that they no longer show by default.
 */
export function openDebug(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Deep debug' }))
}
