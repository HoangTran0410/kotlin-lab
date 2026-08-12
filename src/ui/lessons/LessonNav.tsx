import { LESSON_LIST } from '../../lessons/registry'
import './lesson-nav.css'

/**
 * Khung tối thiểu để bắt đầu từ trang trắng: `main` dạng expression-body gọi
 * thẳng `runBlocking { }` — đây chính là dạng mà `runBlockingLambda` trong
 * `engine/run.ts` nhận diện để root job LÀ coroutine runBlocking, không lồng
 * thêm lớp nào.
 */
const BLANK_SOURCE = 'import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n}\n'

/**
 * Ba nút trong header. Danh sách bài KHÔNG còn nằm ở đây.
 *
 * Bản trước là một dải 13 chip với `max-width: 60vw` + `overflow-x: auto`:
 * khoảng 8 chip lọt vào tầm nhìn, 5 chip còn lại nằm ngoài mép mà không dấu
 * hiệu nào cho biết chúng tồn tại. Chip cũng chỉ chứa nổi số + nhãn cụt, nên
 * tóm tắt và khái niệm của bài phải giấu vào tooltip. Và nó chẳng giống gì
 * danh sách ví dụ trong hộp "Chạy được gì?", dù hai thứ trả lời hai nửa của
 * cùng một câu hỏi.
 *
 * Nay cả hai danh sách nằm trong CÙNG một hộp, hai tab. Header chỉ giữ lối
 * vào, và nói rõ đang ở bài nào — thông tin mà dải chip cũ phải dùng màu nền
 * của một chip nhỏ để nói.
 */
export function LessonNav({ currentLessonId, onMoLoTrinh, onMoGioiThieu, setSource }: {
  currentLessonId: string | null
  onMoLoTrinh: () => void
  onMoGioiThieu: () => void
  setSource: (src: string) => void
}) {
  const bai = LESSON_LIST.find(l => l.id === currentLessonId)

  return (
    <nav className="lesson-nav" aria-label="Lộ trình bài học">
      <button type="button" className="lesson-nav__open" onClick={onMoLoTrinh}>
        <span className="lesson-nav__num">{bai ? bai.order : '—'}</span>
        <span className="lesson-nav__label">
          {bai ? bai.title : `Chọn bài — ${LESSON_LIST.length} bài`}
        </span>
        <span className="lesson-nav__of">{bai ? `/${LESSON_LIST.length}` : ''}</span>
      </button>
      <button type="button" className="lesson-nav__about" onClick={onMoGioiThieu}>
        Chạy được gì?
      </button>
      <button type="button" className="lesson-nav__blank" onClick={() => setSource(BLANK_SOURCE)}>
        Bắt đầu từ trang trắng
      </button>
    </nav>
  )
}
