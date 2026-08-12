import { fireEvent, screen } from '@testing-library/react'

/**
 * Shows the panels around the graph that a test needs.
 *
 * All three default to the state the old single "Deep debug" button produced —
 * editor on, timeline and console off — so any test that inspects the console
 * or the per-event scrubber has to turn it on first. Having to call this at
 * all is exactly the proof that those panels do not show by default.
 *
 * They are now INDEPENDENT toggles: `openDebug()` turns on both (what the old
 * merged button did), while `showPanel('bottom')` turns on just the timeline —
 * the case that used to be impossible and is why the button was split.
 */
export function showPanel(...names: ('Code' | 'Timeline' | 'Console')[]): void {
  for (const name of names) {
    const button = screen.getByRole('button', { name })
    if (button.getAttribute('aria-pressed') !== 'true') fireEvent.click(button)
  }
}

export function openDebug(): void {
  showPanel('Timeline', 'Console')
}
