import { describe, expect, it } from 'vitest'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { LESSONS, loadLessonSource } from '../../src/lessons'

describe('lesson registry — browser build matches Node build', () => {
  it('same id list, same order', () => {
    expect(LESSON_LIST.map(l => l.id)).toEqual(LESSONS.map(l => l.id))
  })

  it('same metadata for each lesson', () => {
    expect(LESSON_LIST).toEqual(LESSONS)
  })

  it('same source content for each lesson — byte-for-byte', () => {
    for (const l of LESSONS) expect(lessonSource(l.id), l.id).toBe(loadLessonSource(l.id))
  })

  it('a nonexistent id returns null, does not throw', () => {
    expect(lessonSource('does-not-exist')).toBeNull()
  })

  it('the list is not empty — every comparison above only means something if it is', () => {
    // The hardcoded number here used to be 9 and had to be updated every time
    // a lesson was added; a constant like that only measures "did someone just
    // add a lesson", which the golden test already does more thoroughly. The
    // thing worth keeping is the FLOOR: if the `src/lessons/*` directory got
    // renamed, BOTH read paths would return empty (Vite's glob wouldn't match,
    // readdirSync would see no directory) — and all three comparison cases
    // above would go green because empty equals empty. This line is the only
    // thing in the file that would go red in that situation.
    expect(LESSON_LIST.length).toBeGreaterThan(0)
  })
})
