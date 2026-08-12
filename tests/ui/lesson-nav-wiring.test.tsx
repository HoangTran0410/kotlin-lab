import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { runSourceSafe } from '../../src/engine/run'

/**
 * "Wiring": tests that render LessonNav/LessonList DIRECTLY (lesson-nav.test.tsx)
 * can't catch bugs like "App forgot to mount nav into Shell's slot" or "App
 * passed the wrong store's loadLesson". Only here, with a real assembled
 * <App/>, real DOM clicks reveal that class of bug.
 *
 * IMPORTANT: App has A LOT of <button>s — every query below is SCOPED to the
 * nav or to the box (role="dialog"), never a bare `getByRole('button')`.
 */
const openLessons = (): HTMLElement => {
  const nav = screen.getByRole('navigation', { name: 'Lesson path' })
  fireEvent.click(within(nav).getAllByRole('button')[0]!)
  return screen.getByRole('dialog')
}

describe('App wiring -> lesson path', () => {
  it('an empty first workspace offers and starts lesson 1 directly', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Start lesson 1' }))

    expect(useLabStore.getState().lessonId).toBe(LESSON_LIST[0]!.id)
    expect(useLabStore.getState().source).toBe(lessonSource(LESSON_LIST[0]!.id))
  })

  it('restore source reverses a lesson overwrite without a confirmation dialog', () => {
    const original = 'fun main() = runBlocking { println("mine") }'
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(original)
    render(<App />)

    const box = openLessons()
    fireEvent.click(box.querySelectorAll<HTMLButtonElement>('.les__card')[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Restore source' }))

    expect(useLabStore.getState().source).toBe(original)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clicking a lesson loads real source, the right lessonId, clamps stepIndex to 0, and closes the box', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('jobtree')!)
    useLabStore.getState().setStep(2)
    render(<App />)

    const box = openLessons()
    const cards = [...box.querySelectorAll<HTMLButtonElement>('.les__card')]
    expect(cards, 'box must have exactly one card per lesson').toHaveLength(LESSON_LIST.length)

    const target = cards[LESSON_LIST.findIndex(l => l.id === 'supervisor')]!
    fireEvent.click(target)

    expect(useLabStore.getState().lessonId).toBe('supervisor')
    expect(useLabStore.getState().source).toBe(lessonSource('supervisor'))
    expect(useLabStore.getState().stepIndex).toBe(0)
    expect(screen.queryByRole('dialog'), 'box does not auto-close after picking a lesson').toBeNull()
  })

  it('the header shows the name of the lesson just picked — not just a colored dot', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    render(<App />)
    const box = openLessons()
    const idx = LESSON_LIST.findIndex(l => l.id === 'parallel')
    fireEvent.click([...box.querySelectorAll<HTMLButtonElement>('.les__card')][idx]!)

    const nav = screen.getByRole('navigation', { name: 'Lesson path' })
    expect(nav).toHaveTextContent(LESSON_LIST[idx]!.title)
  })

  it('both tabs live in the SAME box, switching does not mean closing and reopening', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    render(<App />)
    const box = openLessons()
    expect(within(box).getAllByRole('tab')).toHaveLength(2)

    fireEvent.click(within(box).getByRole('tab', { name: 'What can it run?' }))
    // Still exactly one box, and its content has switched to the other tab.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog')).toHaveTextContent('Not supported yet')
  })

  it('clicking "Start from blank" loads real source into the store, compiles clean', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)

    const before = useLabStore.getState().source
    const nav = screen.getByRole('navigation', { name: 'Lesson path' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Start from blank' }))

    const src = useLabStore.getState().source
    expect(src, 'source must actually change, not a no-op').not.toBe(before)
    expect(runSourceSafe(src).diagnostics).toEqual([])
  })
})
