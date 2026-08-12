import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { CAPABILITIES } from '../../src/ui/about/capabilities'
import { UNSUPPORTED } from '../../src/engine/validator/diagnostics'
import { KOTLIN_VERSION } from '../../src/engine/kotlinVersion'

const openAbout = (): HTMLElement => {
  const nav = screen.getByRole('navigation', { name: 'Lesson path' })
  fireEvent.click(within(nav).getByRole('button', { name: 'What can it run?' }))
  return screen.getByRole('dialog')
}

describe('about page — wired into the app', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
  })

  it("defaults to CLOSED — doesn't block someone who already knows what they're doing", () => {
    render(<App />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('states plainly which Kotlin version semantics are checked against', () => {
    render(<App />)
    expect(openAbout()).toHaveTextContent(KOTLIN_VERSION)
  })

  it("lists every runnable entry, with each example's output", () => {
    render(<App />)
    const box = openAbout()
    for (const group of CAPABILITIES) {
      for (const k of group.items) {
        expect(within(box).getAllByText(k.name).length, `missing entry ${k.name}`).toBeGreaterThan(0)
        // Output is what proves the example actually runs something — without
        // it the card is just a name, exactly what this page exists to replace.
        expect(box.textContent, `${k.name} doesn't show output`).toContain(k.output[0])
      }
    }
  })

  it('lists every NOT-supported construct, with a replacement hint', () => {
    render(<App />)
    const box = openAbout()
    for (const [name, hint] of Object.entries(UNSUPPORTED)) {
      expect(within(box).getAllByText(name).length, `missing ${name}`).toBeGreaterThan(0)
      expect(box.textContent, `${name} is missing a hint`).toContain(hint)
    }
  })

  it('"Open example" loads RUNNABLE code into the editor and closes the box', () => {
    render(<App />)
    const box = openAbout()
    fireEvent.click(within(box).getAllByRole('button', { name: 'Open example' })[0]!)

    expect(screen.queryByRole('dialog'), 'box does not auto-close after opening an example').toBeNull()
    const st = useLabStore.getState()
    expect(st.source).toBe(CAPABILITIES[0]!.items[0]!.kotlin)
    // Not just "source changed": the code must COMPILE CLEAN and PRODUCE A
    // TRACE. An example that loads and immediately flags red is worse than
    // not having this button at all.
    expect(st.compiled.diagnostics).toEqual([])
    expect(st.compiled.events.length).toBeGreaterThan(0)
  })

  it("opening an example clears the active lesson mark — header doesn't lie", () => {
    render(<App />)
    // Pick a lesson through the ACTUAL user path: open the box, Lessons tab, click a card.
    const nav = screen.getByRole('navigation', { name: 'Lesson path' })
    fireEvent.click(within(nav).getAllByRole('button')[0]!)
    const lessonsBox = screen.getByRole('dialog')
    fireEvent.click(lessonsBox.querySelectorAll<HTMLButtonElement>('.les__card')[0]!)
    expect(useLabStore.getState().lessonId).not.toBeNull()

    const box = openAbout()
    fireEvent.click(within(box).getAllByRole('button', { name: 'Open example' })[0]!)
    expect(useLabStore.getState().lessonId, 'old lesson chip stays lit even though the editor holds different code').toBeNull()
  })

  it('Escape closes the box', () => {
    render(<App />)
    openAbout()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
