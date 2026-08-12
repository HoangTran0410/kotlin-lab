/**
 * Bộ đọc Markdown tối giản, đúng bằng tập cú pháp mà `mental-model.md` dùng:
 * `## tiêu đề`, đoạn văn, danh sách `- `, khối mã ```, và trong dòng thì
 * `**đậm**` với `` `mã` ``.
 *
 * Vì sao không kéo một thư viện markdown về: cả bộ này gói gọn trong một file
 * đọc hết được trong một phút, và nó trả ra DỮ LIỆU để React dựng element —
 * không có HTML thô nào được sinh ra, nên cũng không có đường nào để nội dung
 * bài học chèn được thẻ vào trang. Một thư viện markdown đầy đủ đem theo cả
 * `dangerouslySetInnerHTML` lẫn nhu cầu làm sạch HTML, đổi lấy hàng chục cú
 * pháp mà không file nào ở đây dùng tới.
 *
 * Cú pháp không nhận ra thì rơi xuống đoạn văn thường — hiện nguyên văn chứ
 * không biến mất. Mất chữ là kiểu hỏng tệ nhất cho một trang toàn chữ.
 */

export type DoanInline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }

export type Khoi =
  | { k: 'h'; noi: DoanInline[] }
  | { k: 'p'; noi: DoanInline[] }
  | { k: 'ul'; items: DoanInline[][] }
  | { k: 'code'; text: string }

/** Tách `**đậm**` và `` `mã` `` khỏi chữ thường. Dấu lẻ thì giữ nguyên văn. */
export function inline(s: string): DoanInline[] {
  const ra: DoanInline[] = []
  let i = 0
  let dem = ''
  const xa = (): void => { if (dem !== '') { ra.push({ t: 'text', v: dem }); dem = '' } }

  while (i < s.length) {
    if (s.startsWith('**', i)) {
      const het = s.indexOf('**', i + 2)
      if (het > i + 2) { xa(); ra.push({ t: 'bold', v: s.slice(i + 2, het) }); i = het + 2; continue }
    }
    if (s[i] === '`') {
      const het = s.indexOf('`', i + 1)
      if (het > i + 1) { xa(); ra.push({ t: 'code', v: s.slice(i + 1, het) }); i = het + 1; continue }
    }
    dem += s[i]
    i++
  }
  xa()
  return ra
}

export function docMarkdown(src: string): Khoi[] {
  const ra: Khoi[] = []
  const dong = src.split('\n')
  let doan: string[] = []
  let ds: string[] | null = null

  const chotDoan = (): void => {
    if (doan.length > 0) { ra.push({ k: 'p', noi: inline(doan.join(' ')) }); doan = [] }
  }
  const chotDs = (): void => {
    if (ds !== null) { ra.push({ k: 'ul', items: ds.map(inline) }); ds = null }
  }
  const chot = (): void => { chotDoan(); chotDs() }

  for (let i = 0; i < dong.length; i++) {
    const l = dong[i]!
    if (l.startsWith('```')) {
      chot()
      const than: string[] = []
      i++
      while (i < dong.length && !dong[i]!.startsWith('```')) { than.push(dong[i]!); i++ }
      ra.push({ k: 'code', text: than.join('\n') })
      continue
    }
    if (l.trim() === '') { chot(); continue }
    if (l.startsWith('## ')) { chot(); ra.push({ k: 'h', noi: inline(l.slice(3).trim()) }); continue }
    if (l.startsWith('- ')) {
      chotDoan()
      ds ??= []
      ds.push(l.slice(2).trim())
      continue
    }
    // Dòng thụt vào ngay dưới một gạch đầu dòng là phần TIẾP của mục đó, không
    // phải một đoạn mới. Bỏ luật này thì mọi mục dài hai dòng bị cắt làm đôi và
    // nửa sau rơi ra ngoài danh sách.
    if (ds !== null && l.startsWith('  ')) { ds[ds.length - 1] += ` ${l.trim()}`; continue }
    chotDs()
    doan.push(l.trim())
  }
  chot()
  return ra
}
