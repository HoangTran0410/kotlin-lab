import type { ReactNode } from 'react'

export function Panel({ title, children, grow = false }: {
  title: string; children: ReactNode; grow?: boolean
}) {
  return (
    <section className={grow ? 'panel panel--grow' : 'panel'} aria-label={title}>
      <header className="panel__title">{title}</header>
      <div className="panel__body">{children}</div>
    </section>
  )
}
