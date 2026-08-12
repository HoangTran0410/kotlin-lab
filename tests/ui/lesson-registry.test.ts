import { describe, expect, it } from 'vitest'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { LESSONS, loadLessonSource } from '../../src/lessons'

describe('registry lesson — bản browser khớp bản Node', () => {
  it('cùng danh sách id, cùng thứ tự', () => {
    expect(LESSON_LIST.map(l => l.id)).toEqual(LESSONS.map(l => l.id))
  })

  it('cùng metadata từng bài', () => {
    expect(LESSON_LIST).toEqual(LESSONS)
  })

  it('cùng nội dung nguồn từng bài — byte-for-byte', () => {
    for (const l of LESSONS) expect(lessonSource(l.id), l.id).toBe(loadLessonSource(l.id))
  })

  it('id không tồn tại trả null, không ném', () => {
    expect(lessonSource('khong-co')).toBeNull()
  })

  it('danh sách không rỗng — mọi phép so ở trên mới có nghĩa', () => {
    // Con số cứng ở đây từng là 9 và phải sửa mỗi lần thêm bài; một hằng số
    // như thế chỉ đo được "có ai vừa thêm bài không", việc mà golden test đã
    // làm kỹ hơn. Cái đáng giữ là SÀN: nếu thư mục `src/lessons/*` bị đổi tên,
    // CẢ HAI đường đọc cùng trả rỗng (glob của Vite không khớp, readdirSync
    // không thấy thư mục nào) — và cả ba ca so-khớp ở trên đều xanh vì rỗng
    // bằng rỗng. Dòng này là thứ duy nhất trong file đỏ lúc đó.
    expect(LESSON_LIST.length).toBeGreaterThan(0)
  })
})
