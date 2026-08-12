import { LESSON_LIST } from '../../lessons/registry'
import './lesson-nav.css'

/**
 * Minimal skeleton to start from a blank page: `main` as an expression body
 * calling `runBlocking { }` directly — this is exactly the shape that
 * `runBlockingLambda` in `engine/run.ts` recognizes, so the root job IS the
 * runBlocking coroutine, with no extra layer nested on top.
 */
const BLANK_SOURCE = 'import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n}\n'

/**
 * Three buttons in the header. The lesson list is NO LONGER here.
 *
 * The previous version was a strip of 13 chips with `max-width: 60vw` +
 * `overflow-x: auto`: about 8 chips fit into view, the remaining 5 sat past
 * the edge with no sign they existed. A chip could also only hold a number
 * plus a truncated label, so a lesson's summary and concepts had to hide in a
 * tooltip. And it looked nothing like the example list in the "What can it
 * run?" box, even though the two answer two halves of the same question.
 *
 * Now both lists live in the SAME box, as two tabs. The header just keeps the
 * entry point, and states plainly which lesson is open — information the old
 * chip strip had to convey with the background color of one tiny chip.
 */
export function LessonNav({ currentLessonId, onOpenLessons, onOpenAbout, setSource }: {
  currentLessonId: string | null
  onOpenLessons: () => void
  onOpenAbout: () => void
  setSource: (src: string) => void
}) {
  const lesson = LESSON_LIST.find(l => l.id === currentLessonId)

  return (
    <nav className="lesson-nav" aria-label="Lesson path">
      <button type="button" className="lesson-nav__open" onClick={onOpenLessons}>
        <span className="lesson-nav__num">{lesson ? lesson.order : '—'}</span>
        <span className="lesson-nav__label">
          {lesson ? lesson.title : `Pick a lesson — ${LESSON_LIST.length} lessons`}
        </span>
        <span className="lesson-nav__of">{lesson ? `/${LESSON_LIST.length}` : ''}</span>
      </button>
      <button type="button" className="lesson-nav__about" onClick={onOpenAbout}>
        What can it run?
      </button>
      <button type="button" className="lesson-nav__blank" onClick={() => setSource(BLANK_SOURCE)}>
        Start from blank
      </button>
    </nav>
  )
}
