import { describe, expect, it } from 'vitest'
import { docMarkdown, inline } from '../../src/ui/mentalmodel/markdown'

describe('bộ đọc markdown tối giản', () => {
  it('`## x` thành tiêu đề, dòng thường thành đoạn văn', () => {
    expect(docMarkdown('## Mô hình\nmột câu.')).toEqual([
      { k: 'h', noi: [{ t: 'text', v: 'Mô hình' }] },
      { k: 'p', noi: [{ t: 'text', v: 'một câu.' }] },
    ])
  })

  it('hai dòng liền nhau là MỘT đoạn — markdown xuống dòng mềm', () => {
    // Nội dung thật được ngắt dòng ở cột 90 cho dễ đọc trong git diff. Nếu mỗi
    // dòng thành một đoạn <p> thì bài học hiện ra rời rạc từng mẩu.
    const r = docMarkdown('câu đầu\ncâu sau.')
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ k: 'p', noi: [{ t: 'text', v: 'câu đầu câu sau.' }] })
  })

  it('dòng trống ngắt đoạn', () => {
    expect(docMarkdown('a\n\nb').filter(k => k.k === 'p')).toHaveLength(2)
  })

  it('gạch đầu dòng gom thành một danh sách', () => {
    const r = docMarkdown('- một\n- hai')
    expect(r).toEqual([{
      k: 'ul',
      items: [[{ t: 'text', v: 'một' }], [{ t: 'text', v: 'hai' }]],
    }])
  })

  it('dòng thụt vào là phần TIẾP của mục trên, không phải đoạn mới', () => {
    const r = docMarkdown('- mục dài\n  phần tiếp\n- mục hai')
    expect(r).toHaveLength(1)
    const ds = r[0]!
    if (ds.k !== 'ul') throw new Error('không phải danh sách')
    expect(ds.items).toHaveLength(2)
    expect(ds.items[0]).toEqual([{ t: 'text', v: 'mục dài phần tiếp' }])
  })

  it('khối ``` giữ nguyên xuống dòng và khoảng trắng', () => {
    const r = docMarkdown('```\nval a = 1\n  val b = 2\n```')
    expect(r).toEqual([{ k: 'code', text: 'val a = 1\n  val b = 2' }])
  })

  it('`mã` và **đậm** tách ra khỏi chữ thường', () => {
    expect(inline('gọi `delay()` là **hợp tác**')).toEqual([
      { t: 'text', v: 'gọi ' },
      { t: 'code', v: 'delay()' },
      { t: 'text', v: ' là ' },
      { t: 'bold', v: 'hợp tác' },
    ])
  })

  it('dấu lẻ không nuốt mất chữ', () => {
    // Mất chữ là kiểu hỏng tệ nhất cho một trang toàn chữ: không ai biết là
    // thiếu. Nên cú pháp dở dang phải hiện nguyên văn.
    expect(inline('2 * 3 ** 4').map(d => d.v).join('')).toBe('2 * 3 ** 4')
    expect(inline('dấu ` lẻ').map(d => d.v).join('')).toBe('dấu ` lẻ')
  })

  it('không nội dung nào biến mất khi qua bộ đọc', () => {
    // Bất biến bao trùm mọi ca trên: mọi ký tự không phải dấu cú pháp đều phải
    // còn mặt ở đầu ra.
    const src = '## Tiêu đề\n\nmột **đoạn** có `mã`.\n\n- mục một\n- mục `hai`\n\n```\ncode\n```'
    const chu = (k: ReturnType<typeof docMarkdown>[number]): string =>
      k.k === 'code' ? k.text
        : k.k === 'ul' ? k.items.map(i => i.map(d => d.v).join('')).join(' ')
        : k.noi.map(d => d.v).join('')
    const ra = docMarkdown(src).map(chu).join(' ')
    for (const tu of ['Tiêu đề', 'đoạn', 'mã', 'mục một', 'hai', 'code']) {
      expect(ra, `mất "${tu}"`).toContain(tu)
    }
  })
})
