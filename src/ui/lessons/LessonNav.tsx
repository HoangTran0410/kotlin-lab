import { LESSON_LIST } from '../../lessons/registry'
import './lesson-nav.css'

/**
 * Khung tối thiểu để bắt đầu từ trang trắng: `main` dạng expression-body gọi
 * thẳng `runBlocking { }` — đây chính là dạng mà `runBlockingLambda` trong
 * `engine/run.ts` nhận diện để root job LÀ coroutine runBlocking, không lồng
 * thêm lớp nào.
 */
const BLANK_SOURCE = 'import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n}\n'

/** Phần trước dấu gạch ngang của title — nhãn ngắn để xếp vừa một dải ngang. */
function shortLabel(title: string): string {
  const i = title.indexOf(' — ')
  return i === -1 ? title : title.slice(0, i)
}

/**
 * Lộ trình 9 bài, xếp theo `order`, đánh số rõ vì đây là thứ tự DẠY chứ không
 * phải một danh sách để chọn bừa.
 *
 * Bản đầu hiện cả title lẫn summary trên mỗi thẻ rộng 200px. Với ba bài thì
 * vừa; với chín bài thì thành 1800px cuộn ngang trong thanh header — không ai
 * nhìn ra được lộ trình nữa. Giờ mỗi bài là một chip số + nhãn ngắn, còn
 * title/summary đầy đủ nằm ở tooltip (`title`), vẫn đọc được bằng chuột và
 * bằng trình đọc màn hình.
 *
 * Component không tự giữ state nào: `currentLessonId` và hai hàm gọi ngược đều
 * là props từ App.
 */
export function LessonNav({ currentLessonId, loadLesson, setSource }: {
  currentLessonId: string | null
  loadLesson: (id: string) => void
  setSource: (src: string) => void
}) {
  return (
    <nav className="lesson-nav" aria-label="Lộ trình bài học">
      <ol className="lesson-nav__list">
        {LESSON_LIST.map(l => {
          const active = l.id === currentLessonId
          return (
            <li key={l.id}>
              <button
                type="button"
                className={active ? 'lesson-nav__item lesson-nav__item--active' : 'lesson-nav__item'}
                aria-current={active ? 'true' : undefined}
                title={`${l.title}\n${l.summary}`}
                onClick={() => loadLesson(l.id)}
              >
                <span className="lesson-nav__num">{l.order}</span>
                <span className="lesson-nav__label">{shortLabel(l.title)}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <button type="button" className="lesson-nav__blank" onClick={() => setSource(BLANK_SOURCE)}>
        Bắt đầu từ trang trắng
      </button>
    </nav>
  )
}
