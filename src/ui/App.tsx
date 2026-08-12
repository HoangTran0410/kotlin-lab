import { useCallback, useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { Panel } from './layout/Panel'
import { Shell } from './layout/Shell'
import { CodeEditor } from './editor/CodeEditor'
import { diagnosticMarks, setDiagnosticLines } from './editor/diagnosticMarks'
import { DiagnosticsPanel } from './diagnostics/DiagnosticsPanel'
import { clampDiagnosticLine } from './diagnostics/clampLine'
import { GraphCanvas } from './graph/GraphCanvas'
import { toReactFlow } from './graph/toReactFlow'
import { useLayout } from './graph/useLayout'
import { useLabStore } from '../state/store'
import { selectCurrentLine, selectWorld } from '../state/selectors'

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

/**
 * CodeEditor (Task 9) không lộ EditorView của nó ra ngoài — theo đúng ranh
 * giới của task này, CodeEditor.tsx là interface CHỈ ĐỌC, không sửa. Tìm view
 * qua DOM bằng `EditorView.findFromDOM` là kỹ thuật bộ test của dự án đã dùng
 * để chạm view từ bên ngoài component (tests/ui/code-editor.test.tsx,
 * current-line-wiring.test.tsx) — dùng lại đúng kỹ thuật đó ở đây thay vì
 * thêm một prop/ref mới vào CodeEditor.
 */
function findEditorView(host: HTMLDivElement | null): EditorView | null {
  const el = host?.querySelector<HTMLElement>('[data-testid="code-editor"]')
  return el ? EditorView.findFromDOM(el) : null
}

export function App() {
  const source = useLabStore(s => s.source)
  const currentLine = useLabStore(selectCurrentLine)
  const diagnostics = useLabStore(s => s.compiled.diagnostics)
  const compiled = useLabStore(s => s.compiled)
  const world = useLabStore(selectWorld)
  const handleChange = useDebouncedSetSource()
  const editorHost = useRef<HTMLDivElement>(null)

  // Task 15: layout chạy MỘT LẦN mỗi compile (deps = compiled.revision, xem
  // useLayout.ts) — kéo timeline chỉ đổi `world` (qua selectWorld/stepIndex),
  // không chạm lại ELK. toReactFlow (Task 12) là hàm thuần: gộp layout cố
  // định với world theo-step để ra node/edge React Flow, không tính lại vị trí.
  const layout = useLayout(compiled)
  const graphData = toReactFlow(compiled.spec, layout, world)

  // Đẩy diagnostic vào diagnosticMarks (gutter chấm đỏ + gạch chân) mỗi khi
  // danh sách đổi. Cắm field/gutter qua `extraExtensions` (đã có sẵn từ Task
  // 8) lúc mount; ở đây chỉ dispatch DỮ LIỆU — StateField tự kẹp dòng bằng
  // doc THẬT tại thời điểm effect chạy (xem diagnosticMarks.ts), nên dù
  // `source` trong store trễ hơn vài kí tự so với EditorView đang gõ dở thì
  // vẫn không ném.
  useEffect(() => {
    const view = findEditorView(editorHost.current)
    if (!view) return
    view.dispatch({ effects: setDiagnosticLines.of(diagnostics.map(d => d.line)) })
  }, [diagnostics])

  // Bấm một diagnostic trong panel -> cuộn CodeEditor tới dòng đó. Kẹp LẦN
  // NỮA bằng doc thật của view lúc bấm (không chỉ tin số đã kẹp mà
  // DiagnosticsPanel trả về, vốn kẹp theo `source` của store — có thể lệch
  // với doc sống của CodeMirror trong lúc debounce chưa chạy xong).
  const handleJumpToLine = useCallback((line: number) => {
    const view = findEditorView(editorHost.current)
    if (!view) return
    const safeLine = clampDiagnosticLine(line, view.state.doc.lines)
    const pos = view.state.doc.line(safeLine).from
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  }, [])

  return (
    <Shell
      nav={<nav>Bài học</nav>}
      editor={
        <Panel title="Mã Kotlin" grow>
          <div ref={editorHost}>
            <CodeEditor
              value={source}
              onChange={handleChange}
              currentLine={currentLine}
              extraExtensions={diagnosticMarks}
            />
          </div>
        </Panel>
      }
      graph={
        <Panel title="Sơ đồ coroutine" grow>
          <GraphCanvas nodes={graphData.nodes} edges={graphData.edges} />
        </Panel>
      }
      timeline={
        <Panel title="Dòng thời gian">
          <p>Thanh kéo dòng thời gian sẽ vào đây ở task sau.</p>
        </Panel>
      }
      side={
        <Panel title="Console & chẩn đoán" grow>
          <DiagnosticsPanel
            diagnostics={diagnostics}
            docLines={source.split('\n').length}
            onJumpToLine={handleJumpToLine}
          />
          <p>Console sẽ vào đây ở task sau.</p>
        </Panel>
      }
    />
  )
}
