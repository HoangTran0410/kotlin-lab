import type { ReactNode } from 'react'

/**
 * `tone="error"` paints the title red. Used for the error box under the
 * editor: it only appears when there are errors, so it has to read
 * immediately as something to deal with, not just another informational
 * panel.
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
