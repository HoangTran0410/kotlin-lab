import { LESSON_LIST } from '../../lessons/registry'
import './lesson-nav.css'

/**
 * Khung tối thiểu để bắt đầu từ trang trắng: `main` dạng expression-body gọi
 * thẳng `runBlocking { }` — đây chính là dạng mà `runBlockingLambda` trong
 * `engine/run.ts` nhận diện để root job LÀ coroutine runBlocking, không lồng
 * thêm lớp nào. Compile sạch, không diagnostic (task 19, test 5).
 */
const BLANK_SOURCE = 'fun main() = runBlocking {\n}\n'

/**
 * Danh sách ba lesson M1 theo `order` (LESSON_LIST đã sort sẵn — xem
 * `lessons/registry.ts`), đánh dấu bài đang mở, và nút thoát về trang trắng.
 * Component không tự giữ state nào: `currentLessonId` và hai hàm gọi ngược
 * đều là props từ App, cùng slice của store mà mọi panel khác trong App đã
 * dùng — bấm vào lesson gọi thẳng `loadLesson` thật của store, nên
 * `stepIndex` về 0 là hành vi của STORE (đã khoá ở state-store.test.ts), UI
 * ở đây chỉ có nhiệm vụ gọi đúng hàm.
 */
export function LessonNav({ currentLessonId, loadLesson, setSource }: {
  currentLessonId: string | null
  loadLesson: (id: string) => void
  setSource: (src: string) => void
}) {
  return (
    <nav className="lesson-nav" aria-label="Bài học">
      <ul className="lesson-nav__list">
        {LESSON_LIST.map(l => {
          const active = l.id === currentLessonId
          return (
            <li key={l.id}>
              <button
                type="button"
                className={active ? 'lesson-nav__item lesson-nav__item--active' : 'lesson-nav__item'}
                aria-current={active ? 'true' : undefined}
                onClick={() => loadLesson(l.id)}
              >
                <span className="lesson-nav__title">{l.title}</span>
                <span className="lesson-nav__summary">{l.summary}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className="lesson-nav__blank" onClick={() => setSource(BLANK_SOURCE)}>
        Bắt đầu từ trang trắng
      </button>
    </nav>
  )
}
