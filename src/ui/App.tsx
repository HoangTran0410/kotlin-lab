import { useCallback, useEffect, useRef } from 'react'
import { Panel } from './layout/Panel'
import { Shell } from './layout/Shell'
import { CodeEditor } from './editor/CodeEditor'
import { useLabStore } from '../state/store'

/**
 * runSourceSafe biên dịch lại TOÀN BỘ trace (parse + interpret + buildGraphSpec)
 * mỗi lần setSource được gọi. Gọi việc đó trên từng phím gõ sẽ giật khi code
 * dài — nên debounce 250ms ở ranh giới UI, còn CodeEditor tự giữ con trỏ/DOM
 * mượt bằng EditorView nội bộ của chính nó (task 8, kotlinLang.ts).
 */
const SET_SOURCE_DEBOUNCE_MS = 250

function useDebouncedSetSource(): (src: string) => void {
  const setSource = useLabStore(s => s.setSource)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return useCallback(
    (src: string) => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSource(src), SET_SOURCE_DEBOUNCE_MS)
    },
    [setSource],
  )
}

export function App() {
  const source = useLabStore(s => s.source)
  const handleChange = useDebouncedSetSource()

  return (
    <Shell
      nav={<nav>Bài học</nav>}
      editor={
        <Panel title="Mã Kotlin" grow>
          <CodeEditor value={source} onChange={handleChange} />
        </Panel>
      }
      graph={
        <Panel title="Sơ đồ coroutine" grow>
          <p>Sơ đồ coroutine sẽ vào đây ở task sau.</p>
        </Panel>
      }
      timeline={
        <Panel title="Dòng thời gian">
          <p>Thanh kéo dòng thời gian sẽ vào đây ở task sau.</p>
        </Panel>
      }
      side={
        <Panel title="Console & chẩn đoán" grow>
          <p>Console và chẩn đoán sẽ vào đây ở task sau.</p>
        </Panel>
      }
    />
  )
}
