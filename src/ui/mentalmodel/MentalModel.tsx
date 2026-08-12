import { useCallback, useEffect, useState } from 'react'
import { docMarkdown, type DoanInline, type Khoi } from './markdown'
import { lessonMentalModel, LESSON_LIST } from '../../lessons/registry'
import './mental-model.css'

const KHOA = 'kcl.mentalModel.v1'

function Inline({ noi }: { noi: DoanInline[] }) {
  return (
    <>
      {noi.map((d, i) => {
        if (d.t === 'code') return <code key={i}>{d.v}</code>
        if (d.t === 'bold') return <strong key={i}>{d.v}</strong>
        return <span key={i}>{d.v}</span>
      })}
    </>
  )
}

function Khoi({ khoi }: { khoi: Khoi }) {
  if (khoi.k === 'h') return <h4><Inline noi={khoi.noi} /></h4>
  if (khoi.k === 'ul') {
    return (
      <ul>
        {khoi.items.map((it, i) => <li key={i}><Inline noi={it} /></li>)}
      </ul>
    )
  }
  if (khoi.k === 'code') return <pre>{khoi.text}</pre>
  return <p><Inline noi={khoi.noi} /></p>
}

/**
 * Mô hình tư duy của bài đang mở — đặt NGAY TRÊN editor, trong cùng một cột.
 *
 * Chỗ đặt là một phần của thiết kế: người học đọc mô hình, rồi mắt đi thẳng
 * xuống đúng đoạn code hiện thân cho nó, rồi mới sang đồ thị. Nếu để nó ở cột
 * bên phải thì đây là góc màn hình thứ năm phải liếc — đúng thứ đã khiến luồng
 * học bị phân tán trước đây.
 *
 * Gấp/mở được và NHỚ lựa chọn qua các lần mở bài: người đọc lại lần hai không
 * cần đọc lại phần chữ, nhưng người đọc lần đầu thì cần nó mở sẵn — nên mặc
 * định là mở.
 */
export function MentalModel({ lessonId }: { lessonId: string | null }) {
  const [mo, setMo] = useState<boolean>(() => {
    try { return localStorage.getItem(KHOA) !== 'dong' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem(KHOA, mo ? 'mo' : 'dong') } catch { /* chế độ riêng tư */ }
  }, [mo])
  const bat = useCallback(() => setMo(v => !v), [])

  if (lessonId === null) return null
  const md = lessonMentalModel(lessonId)
  if (md === null) return null
  const tieuDe = LESSON_LIST.find(l => l.id === lessonId)?.title ?? lessonId

  return (
    <section className="mm" aria-label="Mô hình tư duy của bài học">
      <button type="button" className="mm__head" onClick={bat} aria-expanded={mo}>
        <span className="mm__caret" aria-hidden="true">{mo ? '▾' : '▸'}</span>
        <span className="mm__title">{tieuDe}</span>
        <span className="mm__hint">{mo ? 'thu gọn' : 'mô hình tư duy'}</span>
      </button>
      {mo && (
        <div className="mm__body">
          {docMarkdown(md).map((k, i) => <Khoi key={i} khoi={k} />)}
        </div>
      )}
    </section>
  )
}
