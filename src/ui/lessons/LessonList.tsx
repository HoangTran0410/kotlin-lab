import { LESSON_IDS_WITH_JVM_FIXTURE, LESSON_LIST } from '../../lessons/registry'

/**
 * The whole lesson path, one card per lesson — replaces the old chip strip in
 * the header.
 *
 * The chip strip had `max-width: 60vw` + `overflow-x: auto`, so with 13
 * lessons only about 8 fit into view and the rest sat past the edge with no
 * sign they existed. A chip could also only hold a number and a truncated
 * label; the summary and concepts had to hide in a tooltip, reachable only by
 * mouse users, and only if they guessed a tooltip was there.
 *
 * Here every lesson shows enough: order number, title, summary, the concepts
 * it teaches, and a mark for whether its output has been checked line-by-line
 * against a real JVM yet.
 */
export function LessonList({ currentLessonId, onPick }: {
  currentLessonId: string | null
  onPick: (id: string) => void
}) {
  return (
    <section className="about__sec" aria-label="Lesson path">
      <p className="about__sub">
        {LESSON_LIST.length} lessons, in teaching order — each one builds on the last. Click to
        open into the editor; the <strong>mental model</strong> section shows right above the code
        pane.
      </p>
      <ul className="mdl__cards">
        {LESSON_LIST.map(l => {
          const isCurrent = l.id === currentLessonId
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`mdl__card les__card${isCurrent ? ' les__card--on' : ''}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => onPick(l.id)}
              >
                <span className="les__top">
                  <span className="les__num">{l.order}</span>
                  <span className="les__title">{l.title}</span>
                  {LESSON_IDS_WITH_JVM_FIXTURE.has(l.id) && (
                    <span className="les__jvm" title="Output checked line-by-line against a real JVM">JVM</span>
                  )}
                </span>
                <p className="les__sum">{l.summary}</p>
                <ul className="les__concepts">
                  {l.concepts.map(c => <li key={c}>{c}</li>)}
                </ul>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
