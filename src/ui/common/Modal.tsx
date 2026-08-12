import { useEffect, useRef, type ReactNode } from 'react'
import './modal.css'

export interface Tab {
  id: string
  nhan: string
  noi: ReactNode
}

/**
 * Hộp phủ toàn màn hình, dùng CHUNG cho lộ trình bài học và trang giới thiệu.
 *
 * Vì sao chung một hộp: hai danh sách ấy trả lời hai nửa của cùng một câu hỏi
 * — "học gì" và "gõ được gì" — nên chúng phải trông như anh em. Trước đây lộ
 * trình là một dải chip trong header còn ví dụ là thẻ trong hộp; dải chip vừa
 * không đồng bộ với hộp kia, vừa GIẤU MẤT bài: `max-width: 60vw` cộng
 * `overflow-x: auto` nên với 13 bài thì chỉ 8 cái lọt vào tầm nhìn và 5 cái
 * còn lại nằm ngoài mép, không một dấu hiệu nào cho biết chúng tồn tại.
 */
export function Modal({ tabs, tabDangMo, setTab, onClose }: {
  tabs: Tab[]
  tabDangMo: string
  setTab: (id: string) => void
  onClose: () => void
}) {
  const hop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    hop.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dangMo = tabs.find(t => t.id === tabDangMo) ?? tabs[0]

  return (
    <div className="mdl" role="presentation" onClick={onClose}>
      <div
        className="mdl__box"
        role="dialog"
        aria-modal="true"
        aria-label={dangMo?.nhan ?? ''}
        tabIndex={-1}
        ref={hop}
        onClick={e => e.stopPropagation()}
      >
        <header className="mdl__head">
          <div className="mdl__tabs" role="tablist">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === dangMo?.id}
                className={t.id === dangMo?.id ? 'mdl__tab mdl__tab--on' : 'mdl__tab'}
                onClick={() => setTab(t.id)}
              >
                {t.nhan}
              </button>
            ))}
          </div>
          <button type="button" className="mdl__close" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        <div className="mdl__body">{dangMo?.noi}</div>
      </div>
    </div>
  )
}
