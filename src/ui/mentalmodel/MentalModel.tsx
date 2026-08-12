import { useCallback, useEffect, useState } from 'react'
import { parseMarkdown, type InlineSpan, type MdBlock } from './markdown'
import { lessonMentalModel, LESSON_LIST } from '../../lessons/registry'
import './mental-model.css'

const STORAGE_KEY = 'kcl.mentalModel.v1'

function Inline({ content }: { content: InlineSpan[] }) {
  return (
    <>
      {content.map((d, i) => {
        if (d.t === 'code') return <code key={i}>{d.v}</code>
        if (d.t === 'bold') return <strong key={i}>{d.v}</strong>
        return <span key={i}>{d.v}</span>
      })}
    </>
  )
}

function MdBlockView({ block }: { block: MdBlock }) {
  if (block.k === 'h') return <h4><Inline content={block.content} /></h4>
  if (block.k === 'ul') {
    return (
      <ul>
        {block.items.map((it, i) => <li key={i}><Inline content={it} /></li>)}
      </ul>
    )
  }
  if (block.k === 'code') return <pre>{block.text}</pre>
  return <p><Inline content={block.content} /></p>
}

/**
 * The mental model for the currently open lesson — placed RIGHT ABOVE the
 * editor, in the same column.
 *
 * The placement is part of the design: the learner reads the model, then
 * their eyes go straight down to the code that embodies it, then over to the
 * graph. Putting it in the right column would make it the fifth corner of the
 * screen to glance at — exactly what used to fragment the learning flow.
 *
 * Collapsible, and REMEMBERS the choice across lesson opens: a second-time
 * reader doesn't need to read the text again, but a first-time reader needs
 * it open by default — so the default is open.
 */
export function MentalModel({ lessonId }: { lessonId: string | null }) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'closed' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed') } catch { /* private mode */ }
  }, [open])
  const toggle = useCallback(() => setOpen(v => !v), [])

  if (lessonId === null) return null
  const md = lessonMentalModel(lessonId)
  if (md === null) return null
  const title = LESSON_LIST.find(l => l.id === lessonId)?.title ?? lessonId

  return (
    <section className="mm" aria-label="Lesson mental model">
      <button type="button" className="mm__head" onClick={toggle} aria-expanded={open}>
        <span className="mm__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="mm__title">{title}</span>
        <span className="mm__hint">{open ? 'collapse' : 'mental model'}</span>
      </button>
      {open && (
        <div className="mm__body">
          {parseMarkdown(md).map((k, i) => <MdBlockView key={i} block={k} />)}
        </div>
      )}
    </section>
  )
}
