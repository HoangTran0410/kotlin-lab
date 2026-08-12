import type { ReactNode } from 'react'

/**
 * `tone="error"` tô đỏ tiêu đề. Dùng cho ô lỗi dưới editor: nó chỉ xuất hiện
 * khi có lỗi, nên phải nhìn ra ngay là chuyện cần xử lý chứ không phải một
 * panel thông tin như mọi panel khác.
 */
export function Panel({ title, children, grow = false, tone = 'normal' }: {
  title: string; children: ReactNode; grow?: boolean; tone?: 'normal' | 'error'
}) {
  const cls = ['panel']
  if (grow) cls.push('panel--grow')
  if (tone === 'error') cls.push('panel--error')
  return (
    <section className={cls.join(' ')} aria-label={title}>
      <header className="panel__title">{title}</header>
      <div className="panel__body">{children}</div>
    </section>
  )
}
