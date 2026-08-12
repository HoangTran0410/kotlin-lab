import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LESSONS } from '../../src/lessons'
import { docMarkdown } from '../../src/ui/mentalmodel/markdown'
import { UNSUPPORTED } from '../../src/engine/validator/diagnostics'

/**
 * Phần chữ của bài học cũng là một thứ có thể sai, và sai ở đây thì tệ hơn sai
 * trong code: không có gì đỏ lên cả, người học chỉ đơn giản là học nhầm.
 *
 * Những gì kiểm được bằng máy thì kiểm ở đây — mọi bài đều có, đủ bốn phần,
 * và không phần nào giới thiệu một construct mà engine sẽ báo đỏ ngay khi gõ.
 */
const duongDan = (id: string) => join('src/lessons', id, 'mental-model.md')
const doc = (id: string) => readFileSync(duongDan(id), 'utf8')

const PHAN_BAT_BUOC = ['Mô hình tư duy', 'Vì sao Kotlin làm thế', 'Chỗ hay sai', 'Nhìn gì trên đồ thị']

describe('mô hình tư duy — mỗi bài một bản', () => {
  it('không bài nào thiếu', () => {
    for (const l of LESSONS) {
      expect(existsSync(duongDan(l.id)), `${l.id} chưa có mental-model.md`).toBe(true)
    }
  })

  it('mỗi bản có đủ bốn phần, đúng thứ tự', () => {
    // Thứ tự là một phần của thiết kế: hiểu mô hình -> hiểu vì sao -> biết chỗ
    // sai -> biết nhìn vào đâu. Đảo lên thì phần "chỗ hay sai" đọc trước khi
    // người ta kịp có mô hình nào để mà sai.
    for (const l of LESSONS) {
      const tieuDe = docMarkdown(doc(l.id))
        .filter(k => k.k === 'h')
        .map(k => (k.k === 'h' ? k.noi.map(d => d.v).join('') : ''))
      expect(tieuDe, `${l.id} thiếu hoặc sai thứ tự các phần`).toEqual(PHAN_BAT_BUOC)
    }
  })

  it('mỗi phần có nội dung thật, không phải tiêu đề rỗng', () => {
    for (const l of LESSONS) {
      const khoi = docMarkdown(doc(l.id))
      for (let i = 0; i < khoi.length; i++) {
        if (khoi[i]!.k !== 'h') continue
        const ke = khoi[i + 1]
        expect(ke, `${l.id}: một phần không có gì bên dưới`).toBeDefined()
        expect(ke!.k, `${l.id}: hai tiêu đề dính liền nhau`).not.toBe('h')
      }
      expect(doc(l.id).length, `${l.id} quá ngắn để là một mô hình tư duy`).toBeGreaterThan(600)
    }
  })

  it('khối mã chép được không chứa construct mà engine sẽ báo đỏ', () => {
    // Chỉ soi KHỐI ``` — thứ người học bôi đen rồi dán vào editor.
    //
    // Bản đầu của ca này soi cả `mã trong dòng`, và nó đỏ ngay: bài `suspend`
    // viết "đừng dùng `Thread.sleep()`" trong phần *Chỗ hay sai*, mà `Thread`
    // nằm trong UNSUPPORTED. Câu văn ấy đúng và cần thiết — luật sai, không
    // phải nội dung. Nhắc tên một API của Kotlin thật để nói "đừng dùng" hoặc
    // "cái này chưa có ở đây" là việc bình thường của phần chữ.
    //
    // Nói thẳng phạm vi: hôm nay đúng MỘT bài có khối ``` (bài `parallel`).
    // Ca này tồn tại để khối thứ hai — và những khối sau nữa — không lọt qua,
    // chứ không phải vì nó đang canh nhiều thứ.
    for (const l of LESSONS) {
      const ma = docMarkdown(doc(l.id)).flatMap(k => (k.k === 'code' ? [k.text] : []))
      for (const doan of ma) {
        for (const cam of Object.keys(UNSUPPORTED)) {
          expect(doan.includes(cam), `${l.id}: mã mẫu dùng ${cam}, engine sẽ báo đỏ`).toBe(false)
        }
      }
    }
  })
})
