import { useEffect, useRef } from 'react'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { kotlinExtensions } from './kotlinLang'
import { currentLineField, setCurrentLine } from './currentLine'

const externalSource = Annotation.define<boolean>()

export function CodeEditor({ value, onChange, currentLine = null, extraExtensions = [] }: {
  value: string
  onChange: (src: string) => void
  /** 1-based line currently running in the trace (Task 9), or null if there's none yet. */
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
          // Called through a ref: putting `onChange` in the deps would rebuild
          // the whole EditorView on every parent re-render, losing the cursor
          // and undo history.
          EditorView.updateListener.of(u => {
            if (u.docChanged && !u.transactions.some(t => t.annotation(externalSource))) {
              onChangeRef.current(u.state.doc.toString())
            }
          }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
    // Builds the EditorView exactly once at mount (empty deps is intentional).
    // onChange is called through onChangeRef so it doesn't need to be in deps;
    // see the note next to onChangeRef above.
  }, [])

  // One-way sync from the outside in (loadLesson). Compare before
  // dispatching, otherwise this becomes an infinite loop with the
  // updateListener above.
  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: externalSource.of(true) })
  }, [value])

  // Only dispatches a single StateEffect — doesn't touch selection/focus, so
  // it never moves the cursor or steals focus from someone mid-typing (the
  // hazard called out in task 9).
  useEffect(() => {
    const v = view.current
    if (!v) return
    v.dispatch({ effects: setCurrentLine.of(currentLine) })
  }, [currentLine])

  return <div className="editor" ref={host} data-testid="code-editor" />
}
