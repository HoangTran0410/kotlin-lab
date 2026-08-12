import { describe, expect, it } from 'vitest'
import { CHAY_DUOC } from '../../src/ui/about/capabilities'
import { UNSUPPORTED } from '../../src/engine/validator/diagnostics'
import { runSource } from '../../src/engine/run'

/**
 * Trang "công cụ chạy được gì" nói dối là hỏng nặng hơn thiếu tính năng: người
 * học đọc xong tin là chạy được, gõ vào, và thấy im lặng hoặc lỗi. Nên mọi mục
 * trong danh sách đều được CHẠY THẬT ở đây và so output từng dòng.
 */
const tatCa = CHAY_DUOC.flatMap(n => n.items)

describe('trang giới thiệu — mọi mục "chạy được" đều chạy thật', () => {
  for (const k of tatCa) {
    it(`${k.ten}: chạy sạch và in đúng output đã ghi`, () => {
      const r = runSource(k.kotlin)
      expect(r.diagnostics, `${k.ten} sinh chẩn đoán`).toEqual([])
      expect(r.output, `${k.ten} in ra khác với output ghi trên thẻ`).toEqual(k.ra)
    })
  }

  it('mỗi mục có đủ tên, mô tả và ít nhất một dòng output', () => {
    // Một mục `ra: []` sẽ đi qua ca trên mà không chứng minh được gì: chương
    // trình không in gì cũng khớp. Ở đây ép mọi ví dụ phải có kết quả nhìn thấy.
    for (const k of tatCa) {
      expect(k.ten.length, 'mục thiếu tên').toBeGreaterThan(1)
      expect(k.mo.length, `${k.ten} thiếu mô tả`).toBeGreaterThan(10)
      expect(k.ra.length, `${k.ten} không in ra gì — ví dụ không quan sát được`).toBeGreaterThan(0)
    }
  })

  it('không mục nào dùng tên nằm trong danh sách CHƯA hỗ trợ', () => {
    // Hai danh sách nằm cạnh nhau trên cùng một trang. Nếu một construct vừa
    // được cài (gỡ khỏi UNSUPPORTED) hoặc vừa bị hoãn (thêm vào UNSUPPORTED)
    // mà chỉ một bên được sửa, người đọc thấy cùng một cái tên ở cả hai cột.
    for (const k of tatCa) {
      for (const cam of Object.keys(UNSUPPORTED)) {
        expect(k.kotlin.includes(cam), `ví dụ "${k.ten}" dùng ${cam} — đang nằm ở cột chưa hỗ trợ`)
          .toBe(false)
      }
    }
  })
})
