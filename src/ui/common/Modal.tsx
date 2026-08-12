import { useEffect, useRef, type ReactNode } from 'react'
import './modal.css'

export interface Tab {
  id: string
  label: string
  content: ReactNode
}

/**
 * Full-screen overlay, SHARED by the lesson path and the about page.
 *
 * Why one shared box: those two lists answer two halves of the same question
 * — "what to learn" and "what can be typed" — so they should look like
 * siblings. Previously the lesson path was a chip strip in the header while
 * examples were cards in a box; the chip strip was both out of sync with the
 * other box AND HID lessons: `max-width: 60vw` plus `overflow-x: auto` meant
 * that with 13 lessons only 8 fit into view and the remaining 5 sat past the
 * edge with no sign they existed.
 */
export function Modal({ tabs, activeTab, setTab, onClose }: {
  tabs: Tab[]
  activeTab: string
  setTab: (id: string) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    box.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const current = tabs.find(t => t.id === activeTab) ?? tabs[0]

  return (
    <div className="mdl" role="presentation" onClick={onClose}>
      <div
        className="mdl__box"
        role="dialog"
        aria-modal="true"
        aria-label={current?.label ?? ''}
        tabIndex={-1}
        ref={box}
        onClick={e => e.stopPropagation()}
      >
        <header className="mdl__head">
          <div className="mdl__tabs" role="tablist">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === current?.id}
                className={t.id === current?.id ? 'mdl__tab mdl__tab--on' : 'mdl__tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="mdl__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="mdl__body">{current?.content}</div>
      </div>
    </div>
  )
}
