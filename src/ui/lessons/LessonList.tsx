import { LESSON_IDS_DOI_CHIEU_JVM, LESSON_LIST } from '../../lessons/registry'

/**
 * Cả lộ trình, mỗi bài một thẻ — thay cho dải chip cũ trong header.
 *
 * Dải chip có `max-width: 60vw` + `overflow-x: auto`, nên với 13 bài thì chỉ
 * khoảng 8 cái lọt vào tầm nhìn và phần còn lại nằm ngoài mép mà không một dấu
 * hiệu nào cho biết chúng tồn tại. Chip cũng chỉ chứa nổi số và một nhãn cụt;
 * tóm tắt và khái niệm của bài phải giấu vào tooltip, tức là chỉ tới được người
 * dùng chuột và chỉ khi họ đoán ra là có tooltip.
 *
 * Ở đây mỗi bài hiện đủ: số thứ tự, tiêu đề, tóm tắt, các khái niệm nó dạy, và
 * dấu cho biết output của bài đã được so từng dòng với JVM thật hay chưa.
 */
export function LessonList({ currentLessonId, onChon }: {
  currentLessonId: string | null
  onChon: (id: string) => void
}) {
  return (
    <section className="about__sec" aria-label="Lộ trình bài học">
      <p className="about__sub">
        {LESSON_LIST.length} bài, xếp theo thứ tự dạy — mỗi bài dựng trên bài trước. Bấm để mở vào
        editor; phần <strong>mô hình tư duy</strong> hiện ngay trên khung mã.
      </p>
      <ul className="mdl__cards">
        {LESSON_LIST.map(l => {
          const dangMo = l.id === currentLessonId
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`mdl__card les__card${dangMo ? ' les__card--on' : ''}`}
                aria-current={dangMo ? 'true' : undefined}
                onClick={() => onChon(l.id)}
              >
                <span className="les__top">
                  <span className="les__num">{l.order}</span>
                  <span className="les__title">{l.title}</span>
                  {LESSON_IDS_DOI_CHIEU_JVM.has(l.id) && (
                    <span className="les__jvm" title="Output đã so từng dòng với JVM thật">JVM</span>
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
