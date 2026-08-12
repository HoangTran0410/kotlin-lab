import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { MAX_LEFT, MIN_LEFT } from '../../src/ui/layout/usePanelWidths'

/**
 * jsdom does NOT install `PointerEvent`, so `fireEvent.pointerMove(el, { clientX })`
 * produces a plain Event and `clientX` never reaches the handler (measured:
 * `clientX = undefined`). Build a `MouseEvent` instead — jsdom has it, and it
 * carries a real clientX — then fire it under the exact event name React is
 * listening for.
 */
function drag(el: Element, name: string, clientX: number): void {
  // Wrapped in `act`: a raw `dispatchEvent` is NOT wrapped by React the way
  // `fireEvent` is, so setState inside the handler hasn't been flushed before
  // the assertion — measured as: the width still holds the old value even
  // though the handler ran correctly.
  act(() => { el.dispatchEvent(new MouseEvent(name, { clientX, bubbles: true })) })
}

const columnWidth = (): number => {
  const main = document.querySelector('.shell__main') as HTMLElement
  return parseInt(main.style.getPropertyValue('--w-left'), 10)
}

describe('dragging columns', () => {
  beforeEach(() => {
    localStorage.clear()
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
  })

  it('dragging the middle handle widens the code column by exactly the dragged amount', () => {
    render(<App />)
    const handle = screen.getByTestId('splitter-Code column width')
    const before = columnWidth()

    drag(handle, 'pointerdown', 500)
    drag(handle, 'pointermove', 620)
    drag(handle, 'pointerup', 620)

    expect(columnWidth()).toBe(before + 120)
  })

  it('dragging past the limit clamps at the bound, never lets the column vanish or swallow the whole screen', () => {
    render(<App />)
    const handle = screen.getByTestId('splitter-Code column width')

    drag(handle, 'pointerdown', 500)
    drag(handle, 'pointermove', -5000)
    expect(columnWidth()).toBe(MIN_LEFT)
    drag(handle, 'pointermove', 5000)
    expect(columnWidth()).toBe(MAX_LEFT)
    drag(handle, 'pointerup', 5000)
  })

  it('left/right arrow keys drag it too — keyboard users are not left behind', () => {
    render(<App />)
    const handle = screen.getByTestId('splitter-Code column width')
    const before = columnWidth()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(columnWidth()).toBeGreaterThan(before)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(columnWidth()).toBe(before)
  })

  it('remembers the width across the next session', () => {
    const { unmount } = render(<App />)
    const handle = screen.getByTestId('splitter-Code column width')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    const dragged = columnWidth()
    unmount()

    render(<App />)
    expect(columnWidth(), 'reopening reset the width to the default').toBe(dragged)
  })

  it('"Reset layout" returns to the initial size', () => {
    render(<App />)
    const handle = screen.getByTestId('splitter-Code column width')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    const dragged = columnWidth()
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    expect(columnWidth()).toBeLessThan(dragged)
  })

  it('a column handle only exists next to a panel that is actually shown', () => {
    // A drag handle for a hidden column is a control that does nothing. Both
    // sides are checked, because they are now toggled independently.
    render(<App />)
    expect(screen.queryByTestId('splitter-Debug column width')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Console' }))
    expect(screen.getByTestId('splitter-Debug column width')).toBeInTheDocument()

    expect(screen.getByTestId('splitter-Code column width')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    expect(screen.queryByTestId('splitter-Code column width')).toBeNull()
  })

  it('a drag event missing coordinates does NOT turn the width into NaN', () => {
    // This is exactly the case that surfaced while writing this test: without
    // the guard, `--w-left: NaNpx` collapses the whole grid.
    //
    // Scope of this guard, measured by actually breaking it: Splitter has TWO
    // guard points (skipping pointerdown with no coordinates, and `clamp`
    // returning the old value on NaN), and EITHER ONE alone is enough — remove
    // one and this case still stays green, remove both and it goes red. So
    // this guards the PROPERTY "width is always a finite number", not the
    // existence of one specific line. Noted here explicitly so nobody later
    // assumes it protects more than it actually does.
    render(<App />)
    const handle = screen.getByTestId('splitter-Code column width')
    const before = columnWidth()
    fireEvent.pointerDown(handle, { pointerId: 1 })
    fireEvent.pointerMove(handle, { pointerId: 1 })
    expect(Number.isFinite(columnWidth())).toBe(true)
    expect(columnWidth()).toBe(before)
  })

  it('corrupted localStorage data does not break the app', () => {
    localStorage.setItem('kcl.panels.v1', 'not json')
    render(<App />)
    expect(columnWidth()).toBeGreaterThanOrEqual(MIN_LEFT)
  })
})
