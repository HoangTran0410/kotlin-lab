import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { kotlinExtensions } from './kotlinLang'
import { currentLineField, setCurrentLine } from './currentLine'

export function CodeEditor({ value, onChange, currentLine = null, extraExtensions = [] }: {
  value: string
  onChange: (src: string) => void
  /** Dòng 1-based đang chạy trong trace (Task 9), hoặc null nếu chưa có. */
  currentLine?: number | null
  extraExtensions?: Extension[]
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          ...kotlinExtensions,
          currentLineField,
          ...extraExtensions,
          // Gọi qua ref: nếu đưa `onChange` vào deps thì mỗi lần cha render lại
          // sẽ dựng lại cả EditorView, làm mất con trỏ và undo history.
          EditorView.updateListener.of(u => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
    // Chỉ dựng EditorView một lần lúc mount (deps rỗng có chủ ý). onChange gọi
    // qua onChangeRef nên không cần trong deps; xem chú thích cạnh onChangeRef ở trên.
  }, [])

  // Đồng bộ một chiều từ ngoài vào (loadLesson). So sánh trước khi dispatch,
  // nếu không sẽ thành vòng lặp vô hạn với updateListener ở trên.
  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  // Chỉ dispatch một StateEffect — không đụng selection/focus, nên không di
  // chuyển con trỏ hay cướp focus của người đang gõ (hazard nêu ở task 9).
  useEffect(() => {
    const v = view.current
    if (!v) return
    v.dispatch({ effects: setCurrentLine.of(currentLine) })
  }, [currentLine])

  return <div className="editor" ref={host} data-testid="code-editor" />
}
