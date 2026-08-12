import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { REGION_LABEL, REGIONS } from '../../src/ui/layout/usePanelVisibility'

const toggle = (name: string): HTMLElement => screen.getByRole('button', { name })
const isOn = (name: string): boolean => toggle(name).getAttribute('aria-pressed') === 'true'

describe('panel visibility — one toggle per region', () => {
  it('has a toggle for every region, and none for the graph', () => {
    render(<App />)
    for (const r of REGIONS) expect(toggle(REGION_LABEL[r])).toBeInTheDocument()
    // The graph is what everything else sits around; a toggle for it would
    // only produce a state with nothing left to look at.
    expect(screen.queryByRole('button', { name: 'Graph' })).toBeNull()
  })

  it('defaults match what the old single button produced: code on, the other two off', () => {
    // Splitting the button must not silently rearrange anyone's screen.
    render(<App />)
    expect(isOn('Code')).toBe(true)
    expect(isOn('Timeline')).toBe(false)
    expect(isOn('Console')).toBe(false)
  })

  it('each toggle reports its own state, and changes only itself', () => {
    render(<App />)
    fireEvent.click(toggle('Timeline'))
    expect(isOn('Timeline')).toBe(true)
    expect(isOn('Console'), 'Console followed Timeline').toBe(false)
    expect(isOn('Code'), 'Code followed Timeline').toBe(true)
  })

  it('remembers the choice on the next open', () => {
    const { unmount } = render(<App />)
    fireEvent.click(toggle('Timeline'))
    fireEvent.click(toggle('Code'))
    unmount()

    render(<App />)
    expect(isOn('Timeline'), 'timeline forgot it was on').toBe(true)
    expect(isOn('Code'), 'code forgot it was off').toBe(false)
  })

  it('corrupt storage falls back to defaults instead of breaking the app', () => {
    localStorage.setItem('kcl.panels.show.v1', 'not json')
    render(<App />)
    expect(isOn('Code')).toBe(true)
    expect(isOn('Console')).toBe(false)
  })

  it('hiding the code column leaves the graph in place', () => {
    // Hiding a side panel must not take the middle down with it — the grid has
    // a separate column layout per combination, and getting one wrong would
    // drop the centre.
    render(<App />)
    fireEvent.click(toggle('Code'))
    expect(document.querySelector('.shell__left')).toBeNull()
    expect(document.querySelector('.shell__center')).toBeInTheDocument()
  })
})
