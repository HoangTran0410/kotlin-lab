import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { Panel } from './layout/Panel'
import { Shell } from './layout/Shell'
import { CodeEditor } from './editor/CodeEditor'
import { diagnosticMarks, setDiagnosticLines } from './editor/diagnosticMarks'
import { DiagnosticsPanel } from './diagnostics/DiagnosticsPanel'
import { clampDiagnosticLine } from './diagnostics/clampLine'
import { ConsolePanel } from './console/ConsolePanel'
import { LessonNav } from './lessons/LessonNav'
import { AboutContent } from './about/AboutContent'
import { LessonList } from './lessons/LessonList'
import { Modal } from './common/Modal'
import { MentalModel } from './mentalmodel/MentalModel'
import { GraphStage } from './graph/GraphStage'
import { toReactFlow } from './graph/toReactFlow'
import { useLayout } from './graph/useLayout'
import { NarrationPanel } from './narration/NarrationPanel'
import { narrateTrace } from '../engine/narrate/narrateTrace'
import { Timeline } from './timeline/Timeline'
import { PlaybackControls } from './timeline/PlaybackControls'
import { useLabStore } from '../state/store'
import { LESSON_LIST } from '../lessons/registry'
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
  const stepIndex = useLabStore(s => s.stepIndex)
  const setStep = useLabStore(s => s.setStep)
  const lessonId = useLabStore(s => s.lessonId)
  const loadLesson = useLabStore(s => s.loadLesson)
  const loadSource = useLabStore(s => s.loadSource)
  const handleChange = useDebouncedSetSource()
  // Hộp chung cho lộ trình + trang giới thiệu. `null` = đang đóng.
  const [tab, setTab] = useState<string | null>(null)
  // Bảng gỡ lỗi (console + chẩn đoán + diễn giải đầy đủ + timeline từng event)
  // mặc định ĐÓNG: đồ thị đã tự kể được chuyện gì đang xảy ra.
  const [debugOpen, setDebugOpen] = useState(false)
  const toggleDebug = useCallback(() => setDebugOpen(v => !v), [])
  const editorHost = useRef<HTMLDivElement>(null)

  // Task 15: layout chạy MỘT LẦN mỗi compile (deps = compiled.revision, xem
  // useLayout.ts) — kéo timeline chỉ đổi `world` (qua selectWorld/stepIndex),
  // không chạm lại ELK. toReactFlow (Task 12) là hàm thuần: gộp layout cố
  // định với world theo-step để ra node/edge React Flow, không tính lại vị trí.
  const layout = useLayout(compiled)
  const graphData = toReactFlow(compiled.spec, layout, world)

  // Diễn giải phụ thuộc TRACE, không phụ thuộc step — tính một lần mỗi lần
  // compile. Memo ở đây là để giữ ỔN ĐỊNH THAM CHIẾU (mảng mới mỗi render sẽ
  // bắt NarrationPanel render lại vô ích), không phải vì narrateTrace chậm:
  // nó duyệt một lượt.
  const narration = useMemo(() => narrateTrace(compiled.events), [compiled.events])

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
    <>
    <Shell
      debugOpen={debugOpen}
      nav={
        <LessonNav
          currentLessonId={lessonId}
          onMoLoTrinh={() => setTab('lo-trinh')}
          onMoGioiThieu={() => setTab('chay-duoc')}
          setSource={loadSource}
        />
      }
      editor={
        <div className="editor-col">
          {/* Trên editor, không phải ở cột bên: đọc mô hình xong thì mắt đi
              thẳng xuống đúng đoạn code hiện thân cho nó. */}
          <MentalModel lessonId={lessonId} />
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
          {/* Lỗi nằm NGAY DƯỚI code, không nằm sau nút gỡ lỗi. Trước đây
              diagnostic chỉ có trong bảng gỡ lỗi (mặc định đóng), nên người
              học thấy dòng bị gạch đỏ trong editor mà không có một chữ nào
              giải thích — biết là sai, không biết sai gì. Chỉ hiện khi CÓ lỗi:
              lúc code sạch thì cả chiều cao thuộc về editor. */}
          {diagnostics.length > 0 && (
            <Panel title={`${diagnostics.length} lỗi cần sửa`} tone="error">
              <DiagnosticsPanel
                diagnostics={diagnostics}
                docLines={source.split('\n').length}
                onJumpToLine={handleJumpToLine}
              />
            </Panel>
          )}
        </div>
      }
      graph={
        <Panel title="Sơ đồ coroutine" grow>
          <GraphStage
            graph={graphData}
            narration={narration}
            stepIndex={stepIndex}
            setStep={setStep}
            total={compiled.events.length}
            debugOpen={debugOpen}
            toggleDebug={toggleDebug}
            events={compiled.events}
            source={source}
          />
        </Panel>
      }
      timeline={
        <Panel title="Dòng thời gian">
          <Timeline events={compiled.events} stepIndex={stepIndex} setStep={setStep} />
          <PlaybackControls stepIndex={stepIndex} setStep={setStep} max={compiled.events.length} />
        </Panel>
      }
      side={
        <>
          <Panel title="Đang xảy ra gì" grow>
            <NarrationPanel lines={narration} stepIndex={stepIndex} onJump={setStep} />
          </Panel>
          {/* Chẩn đoán đã chuyển sang cột mã (ngay dưới editor) — ở đây chỉ
              còn console, để không hiện cùng một lỗi ở hai chỗ. */}
          <Panel title="Console">
            <ConsolePanel events={compiled.events} stepIndex={stepIndex} />
          </Panel>
        </>
      }
    />
    {tab !== null && (
      <Modal
        tabDangMo={tab}
        setTab={setTab}
        onClose={() => setTab(null)}
        tabs={[
          {
            id: 'lo-trinh',
            nhan: `Lộ trình · ${LESSON_LIST.length} bài`,
            noi: (
              <LessonList
                currentLessonId={lessonId}
                onChon={id => { loadLesson(id); setTab(null) }}
              />
            ),
          },
          {
            id: 'chay-duoc',
            nhan: 'Chạy được gì?',
            noi: <AboutContent onMoViDu={src => { loadSource(src); setTab(null) }} />,
          },
        ]}
      />
    )}
    </>
  )
}
