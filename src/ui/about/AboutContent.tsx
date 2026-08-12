import { CHAY_DUOC } from './capabilities'
import { UNSUPPORTED } from '../../engine/validator/diagnostics'
import { KOTLIN_VERSION } from '../../engine/kotlinVersion'
import { DISPATCHER_POOL_SIZE } from '../../engine/runtime/dispatcher'
import { LESSON_IDS_DOI_CHIEU_JVM, LESSON_LIST } from '../../lessons/registry'

/**
 * "Công cụ này chạy được gì" — câu hỏi đầu tiên của mọi người mở app lần đầu,
 * và trước đây không có chỗ nào trả lời. Người học phải gõ thử rồi đoán từ chỗ
 * im lặng.
 *
 * Ba cột dữ liệu ở đây đều SUY RA, không chép tay:
 *   - "chạy được": từ `capabilities.ts`, mà mỗi mục đều được chạy thật trong
 *     `tests/ui/capabilities.test.ts` và so output từng dòng.
 *   - "chưa chạy được": từ chính bảng UNSUPPORTED mà validator dùng để báo lỗi.
 *     Hai danh sách không thể lệch nhau vì chúng là MỘT.
 *   - pool thread: từ DISPATCHER_POOL_SIZE của engine.
 */
export function AboutContent({ onMoViDu }: { onMoViDu: (src: string) => void }) {
  const soBaiJvm = LESSON_LIST.filter(l => LESSON_IDS_DOI_CHIEU_JVM.has(l.id)).length

  return (
    <>
      <p className="about__sub">
        Đây là một <strong>mô phỏng</strong>, không phải trình biên dịch Kotlin. Nó đọc một tập con
        của Kotlin và diễn ra từng bước của coroutine để nhìn thấy được.
      </p>
      <section className="about__sec">
            <h3>Neo vào Kotlin nào</h3>
            <ul className="about__facts">
              <li>
                Ngữ nghĩa đối chiếu với <strong>Kotlin {KOTLIN_VERSION}</strong> + kotlinx.coroutines,
                chạy trên JVM thật qua Kotlin Playground.
              </li>
              <li>
                <strong>{soBaiJvm}/{LESSON_LIST.length} bài</strong> có output đã so từng dòng với
                JVM thật và được commit thành fixture. Số bài còn lại cố ý để một exception không
                bắt lan tới handler mặc định — chỗ đó sandbox của playground giết tiến trình ở một
                thời điểm không lặp lại được, nên ghi lại số đo ấy là đóng băng sự bất định của
                sandbox chứ không phải ngữ nghĩa Kotlin.
              </li>
              <li>
                Cú pháp: một tập con — đủ để viết mọi bài trong lộ trình, không đủ để chạy code
                sản phẩm. Xem hai cột bên dưới.
              </li>
            </ul>
          </section>

          <section className="about__sec">
            <h3>Chạy được — bấm để mở thẳng vào editor</h3>
            {CHAY_DUOC.map(nhom => (
              <div key={nhom.tieuDe} className="about__group">
                <h4>{nhom.tieuDe}</h4>
                <ul className="mdl__cards">
                  {nhom.items.map(k => (
                    <li key={k.ten} className="mdl__card">
                      <div className="mdl__cardHead">
                        <code className="about__ten">{k.ten}</code>
                        <button
                          type="button"
                          className="about__try"
                          onClick={() => onMoViDu(k.kotlin)}
                        >
                          Mở ví dụ
                        </button>
                      </div>
                      <p className="about__mo">{k.mo}</p>
                      <pre className="about__ra" aria-label={`Output của ví dụ ${k.ten}`}>
                        {k.ra.join('\n')}
                      </pre>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="about__sec">
            <h3>Chưa chạy được — gõ vào sẽ bị báo đỏ, không im lặng</h3>
            <ul className="about__unsup">
              {Object.entries(UNSUPPORTED).map(([ten, goiY]) => (
                <li key={ten}>
                  <code>{ten}</code>
                  <span>{goiY}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="about__sec">
            <h3>Khác Kotlin thật ở đâu</h3>
            <ul className="about__facts">
              <li>
                <strong>Thứ tự chạy là duy nhất.</strong> Cùng một đoạn code luôn cho cùng một
                trace. Kotlin thật chạy đa luồng và có thể xen kẽ khác — nhất là giữa các coroutine
                cùng sẵn sàng tại một thời điểm.
              </li>
              <li>
                <strong>Đồng hồ là ảo.</strong> <code>delay(1000)</code> không tốn một giây nào; nó
                nhảy thẳng tới mốc thời gian kế tiếp. Nhờ vậy so được 200ms với 400ms mà không phải
                ngồi chờ.
              </li>
              <li>
                <strong>Thread là ảo và ít hơn thực tế</strong> cho vừa hình vẽ:{' '}
                {Object.entries(DISPATCHER_POOL_SIZE).map(([d, n], i) => (
                  <span key={d}>{i > 0 ? ', ' : ''}<code>{d}</code> {n}</span>
                ))}.
              </li>
              <li>
                <strong>Không mô phỏng tranh chấp tài nguyên.</strong> Hai coroutine cùng ghi một
                biến ở đây sẽ không bao giờ cho ra kết quả sai như trên JVM thật — race condition
                nằm ngoài phạm vi công cụ này.
              </li>
            </ul>
      </section>
    </>
  )
}
