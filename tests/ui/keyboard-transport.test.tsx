import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'

const step = (): number => useLabStore.getState().stepIndex
const total = (): number => useLabStore.getState().compiled.events.length
const key = (k: string, target: Element | Window = window): void => {
  act(() => { fireEvent.keyDown(target, { key: k }) })
}

describe('keyboard transport', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null, breakpoints: [] })
    act(() => { useLabStore.getState().loadSource(lessonSource('supervisor')!) })
  })

  it('→ and ← move forward and back', () => {
    render(<App />)
    key('ArrowRight')
    const after = step()
    expect(after, '→ did not advance').toBeGreaterThan(0)
    key('ArrowLeft')
    expect(step(), '← did not go back').toBeLessThan(after)
  })

  it('Home and End jump to the two ends', () => {
    render(<App />)
    key('End')
    expect(step()).toBe(total())
    key('Home')
    expect(step()).toBe(0)
  })

  it('Space toggles play, and the button agrees it is playing', () => {
    render(<App />)
    const button = () => screen.getByRole('button', { name: /Play by step|Pause step playback/ })
    expect(button().getAttribute('aria-pressed')).toBe('false')
    key(' ')
    expect(button().getAttribute('aria-pressed'), 'Space did not start playback').toBe('true')
    key(' ')
    expect(button().getAttribute('aria-pressed'), 'Space did not stop playback').toBe('false')
  })

  it('does NOTHING while the user is typing in the editor', () => {
    // The single most important case here. The main thing on screen is a code
    // editor, where Space, arrows, Home and End all have their own obvious
    // meanings — stealing them mid-typing would make the editor feel broken.
    render(<App />)
    const editor = document.querySelector('.cm-content') ?? document.querySelector('.cm-editor')!
    const before = step()
    key('ArrowRight', editor)
    key('End', editor)
    key(' ', editor)
    expect(step(), 'a keystroke inside the editor moved the trace').toBe(before)
    expect(screen.getByRole('button', { name: /Play by step/ }).getAttribute('aria-pressed'))
      .toBe('false')
  })

  it('leaves modified keystrokes alone so OS and browser shortcuts still work', () => {
    render(<App />)
    const before = step()
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true }) })
    act(() => { fireEvent.keyDown(window, { key: 'End', ctrlKey: true }) })
    expect(step()).toBe(before)
  })

  it('is inert when there is no trace to move through', () => {
    render(<App />)
    act(() => { useLabStore.getState().loadSource('') })
    key('End')
    expect(step()).toBe(0)
  })
})

describe('jump to end', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null, breakpoints: [] })
    act(() => { useLabStore.getState().loadSource(lessonSource('supervisor')!) })
  })

  it('the ⏭ button goes to the very last step, and then disables itself', () => {
    // ⏮ existed on its own until now: reaching the end meant holding the step
    // button or dragging the scrubber in the debug panel — and the final state
    // is the one people most often want to see first.
    render(<App />)
    const end = screen.getByRole('button', { name: 'Jump to end' })
    fireEvent.click(end)
    expect(step()).toBe(total())
    expect(screen.getByRole('button', { name: 'Jump to end' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to start' })).toBeEnabled()
  })
})
