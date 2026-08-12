import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LessonNav } from '../../src/ui/lessons/LessonNav'
import { LessonList } from '../../src/ui/lessons/LessonList'
import { LESSON_IDS_WITH_JVM_FIXTURE, LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { runSourceSafe } from '../../src/engine/run'

const navProps = {
  currentLessonId: null, onOpenLessons: () => {}, onOpenAbout: () => {}, setSource: () => {},
}

describe('LessonNav — three entry points in the header', () => {
  it('no lesson open yet: invites you to pick one, and says how many there are', () => {
    render(<LessonNav {...navProps} />)
    const button = screen.getByRole('button', { name: new RegExp(`Pick a lesson.*${LESSON_LIST.length} lessons`) })
    expect(button).toBeInTheDocument()
  })

  it('with a lesson open, shows the NUMBER and TITLE of that exact lesson', () => {
    // The old chip strip could only say "which lesson is open" through the
    // background color of a tiny chip — one that might be sitting outside the
    // scroll area.
    const lesson = LESSON_LIST[4]!
    render(<LessonNav {...navProps} currentLessonId={lesson.id} />)
    const button = screen.getByRole('button', { name: new RegExp(lesson.title) })
    expect(button).toHaveTextContent(String(lesson.order))
  })

  it('the two buttons open two different tabs of the same box', () => {
    const onOpenLessons = vi.fn()
    const onOpenAbout = vi.fn()
    render(<LessonNav {...navProps} onOpenLessons={onOpenLessons} onOpenAbout={onOpenAbout} />)
    fireEvent.click(screen.getByRole('button', { name: /Pick a lesson/ }))
    fireEvent.click(screen.getByRole('button', { name: 'What can it run?' }))
    expect(onOpenLessons).toHaveBeenCalledTimes(1)
    expect(onOpenAbout).toHaveBeenCalledTimes(1)
  })

  it('"Start from blank" sets a source that compiles clean', () => {
    const setSource = vi.fn()
    render(<LessonNav {...navProps} setSource={setSource} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start from blank' }))
    expect(setSource).toHaveBeenCalledTimes(1)
    const src = setSource.mock.calls[0]![0] as string
    expect(runSourceSafe(src).diagnostics).toEqual([])
  })

  it('shows a one-click restore action only when a source can be restored', () => {
    const onRestoreSource = vi.fn()
    const { rerender } = render(<LessonNav {...navProps} canRestoreSource={false} onRestoreSource={onRestoreSource} />)
    expect(screen.queryByRole('button', { name: 'Restore source' })).toBeNull()

    rerender(<LessonNav {...navProps} canRestoreSource onRestoreSource={onRestoreSource} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore source' }))
    expect(onRestoreSource).toHaveBeenCalledTimes(1)
  })
})

describe('LessonList — the whole path, no lesson hidden', () => {
  it('shows EVERY lesson, none cut off', () => {
    // This is exactly the previous version's bug: the chip strip's
    // `max-width: 60vw; overflow-x: auto` meant only about 8/13 lessons fit
    // into view, the rest left no trace.
    const { container } = render(<LessonList currentLessonId={null} onPick={() => {}} />)
    expect(container.querySelectorAll('.les__card')).toHaveLength(LESSON_LIST.length)
  })

  it('every card carries number, title, summary and concepts — none hidden in a tooltip', () => {
    const { container } = render(<LessonList currentLessonId={null} onPick={() => {}} />)
    const cards = [...container.querySelectorAll<HTMLElement>('.les__card')]
    for (const [i, card] of cards.entries()) {
      const l = LESSON_LIST[i]!
      expect(card).toHaveTextContent(String(l.order))
      expect(card).toHaveTextContent(l.title)
      expect(card, `${l.id} is missing its summary`).toHaveTextContent(l.summary)
      for (const c of l.concepts) {
        expect(within(card).getByText(c), `${l.id} is missing concept ${c}`).toBeInTheDocument()
      }
    }
  })

  it('marks the open lesson, exactly ONE lesson', () => {
    const id = LESSON_LIST[2]!.id
    const { container } = render(<LessonList currentLessonId={id} onPick={() => {}} />)
    const on = container.querySelectorAll('.les__card--on')
    expect(on).toHaveLength(1)
    expect(on[0]!.getAttribute('aria-current')).toBe('true')
    expect(on[0]!).toHaveTextContent(LESSON_LIST[2]!.title)
  })

  it('clicking a card calls onPick with the right id', () => {
    const onPick = vi.fn()
    const { container } = render(<LessonList currentLessonId={null} onPick={onPick} />)
    const cards = container.querySelectorAll<HTMLButtonElement>('.les__card')
    const idx = LESSON_LIST.findIndex(l => l.id === 'supervisor')
    fireEvent.click(cards[idx]!)
    expect(onPick).toHaveBeenCalledWith('supervisor')
  })

  it('the JVM mark only appears on lessons that ACTUALLY have a fixture', () => {
    // This mark speaks to that lesson's reliability. Slap it on all 13
    // lessons and it becomes decoration, and learners misplace trust in the 4
    // lessons that haven't been checked.
    const { container } = render(<LessonList currentLessonId={null} onPick={() => {}} />)
    const cards = [...container.querySelectorAll<HTMLElement>('.les__card')]
    const marked = cards.filter(c => c.querySelector('.les__jvm') !== null).length
    expect(marked).toBe(LESSON_LIST.filter(l => LESSON_IDS_WITH_JVM_FIXTURE.has(l.id)).length)
    expect(marked, 'no lesson has the mark — the fixture went unrecognized').toBeGreaterThan(0)
    expect(marked, 'every lesson has the mark — the mark becomes meaningless').toBeLessThan(LESSON_LIST.length)
  })

  it('every lesson in the list loads real source', () => {
    for (const l of LESSON_LIST) {
      expect(lessonSource(l.id), `${l.id} has no source`).not.toBeNull()
    }
  })
})
