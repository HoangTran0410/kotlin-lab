import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'

/**
 * Đối chiếu output của simulator với output THẬT chạy trên JVM.
 *
 * Golden trace neo simulator vào chính nó — nó bắt được thay đổi, nhưng nếu
 * ngữ nghĩa sai ngay từ đầu thì nó chốt luôn cái sai. Đây là tuyến duy nhất
 * neo vào Kotlin thật.
 *
 * Fixture lấy MỘT LẦN từ `api.kotlinlang.org` (Kotlin 2.1.20, confType=java)
 * rồi commit. Test này KHÔNG gọi mạng — chạy offline được.
 *
 * ── Vì sao chỉ một phần lesson có fixture ───────────────────────────────────
 * Bốn bài (`normalfail`, `supervisor`, `scopecompare`, `nestedtrap`) CỐ Ý để
 * một exception không được bắt lan tới handler mặc định — đó chính là bài học
 * của chúng. Trên sandbox của playground, khi stack trace chạm stderr thì tiến
 * trình bị giết ở một thời điểm KHÔNG LẶP LẠI ĐƯỢC: đo được cùng một hình dạng
 * chương trình cho lúc thì đủ output, lúc thì cụt giữa chừng (`scopecompare`
 * ra 1 dòng, bản rút gọn của chính nó ra 2 dòng). Ghi số đo đó thành fixture
 * là đóng băng sự bất định của sandbox chứ không phải ngữ nghĩa Kotlin.
 *
 * Nên: có fixture thì so nghiêm ngặt; không có thì nói rõ vì sao, chứ không
 * lặng lẽ bỏ qua. Ngữ nghĩa của bốn bài kia được neo bằng test riêng của từng
 * bài (quan hệ cha-con, chiều lan truyền, `blockedBySupervisor`).
 */
const KHONG_CO_FIXTURE: Record<string, string> = {
  normalfail: 'exception không bắt lan tới handler mặc định — sandbox playground giết tiến trình không lặp lại được',
  supervisor: 'exception không bắt lan tới handler mặc định — sandbox playground giết tiến trình không lặp lại được',
  scopecompare: 'exception không bắt lan tới handler mặc định — sandbox playground giết tiến trình không lặp lại được',
  nestedtrap: 'exception không bắt lan tới handler mặc định — sandbox playground giết tiến trình không lặp lại được',
}

const fixturePath = (id: string) => join('src/lessons', id, 'expected-jvm-output.txt')

const readFixture = (id: string): string[] => {
  const raw = readFileSync(fixturePath(id), 'utf8').split('\n')
  // File luôn kết thúc bằng newline; bỏ phần tử rỗng cuối cùng do split sinh ra.
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  return raw
}

describe('đối chiếu JVM thật', () => {
  for (const l of LESSONS) {
    const lyDo = KHONG_CO_FIXTURE[l.id]
    if (lyDo !== undefined) {
      it(`${l.id}: KHÔNG có fixture — ${lyDo}`, () => {
        // Khẳng định theo chiều DƯƠNG: file phải THẬT SỰ không tồn tại. Nếu ai
        // đó thêm fixture cho bài này mà không gỡ nó khỏi danh sách miễn trừ,
        // ca này đỏ — thay vì fixture nằm đó mà không ai so.
        expect(existsSync(fixturePath(l.id)), `${l.id} có fixture nhưng vẫn nằm trong danh sách miễn trừ`).toBe(false)
      })
      continue
    }

    it(`${l.id}: output simulator khớp từng dòng với JVM thật`, () => {
      const jvm = readFixture(l.id)
      expect(runSource(loadLessonSource(l.id)).output).toEqual(jvm)
    })
  }

  it('mọi lesson đều được xử lý: hoặc có fixture, hoặc có lý do miễn trừ', () => {
    // Canh chính hạ tầng. Không có ca này thì một lesson mới thêm vào sẽ lặng
    // lẽ không được đối chiếu với gì cả — vòng lặp trên vẫn chạy, chỉ là không
    // sinh ra ca nào cho nó.
    for (const l of LESSONS) {
      const coFixture = existsSync(fixturePath(l.id))
      const duocMienTru = KHONG_CO_FIXTURE[l.id] !== undefined
      expect(coFixture || duocMienTru, `${l.id} vừa không có fixture vừa không có lý do miễn trừ`).toBe(true)
    }
  })

  it('có ít nhất 5 lesson được neo vào JVM thật', () => {
    // Ngưỡng chống trôi: nếu ai đó "sửa" một lệch bằng cách xoá fixture, ca này đỏ.
    const soCoFixture = LESSONS.filter(l => existsSync(fixturePath(l.id))).length
    expect(soCoFixture).toBeGreaterThanOrEqual(5)
  })
})
