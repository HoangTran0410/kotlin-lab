import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { Panel } from './layout/Panel'
import { Shell } from './layout/Shell'
import { CodeEditor } from './editor/CodeEditor'
import { diagnosticMarks, setDiagnosticLines } from './editor/diagnosticMarks'
import { breakpointGutter, setBreakpointLines, setReachableLines } from './editor/breakpointGutter'
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
import { linesInTrace } from '../engine/trace/breakpoints'
import { Timeline } from './timeline/Timeline'
import { PlaybackControls } from './timeline/PlaybackControls'
import { useLabStore } from '../state/store'
import { LESSON_LIST } from '../lessons/registry'
import { selectCurrentLine, selectWorld } from '../state/selectors'

/**
 * runSourceSafe recompiles the WHOLE trace (parse + interpret + buildGraphSpec)
 * every time setSource is called. Calling that on every keystroke would judder
 * on long code — so we debounce 250ms at the UI boundary, while CodeEditor
 * keeps its own cursor/DOM smooth with its own internal EditorView (task 8,
 * kotlinLang.ts).
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
 * CodeEditor (Task 9) does not expose its EditorView to the outside — per this
 * task's boundary, CodeEditor.tsx is a READ-ONLY interface, not to be modified.
 * Finding the view through the DOM with `EditorView.findFromDOM` is the
 * technique the project's own test suite already uses to reach the view from
 * outside the component (tests/ui/code-editor.test.tsx,
 * current-line-wiring.test.tsx) — reusing that same technique here instead of
 * adding a new prop/ref to CodeEditor.
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
  const breakpoints = useLabStore(s => s.breakpoints)
  // Zustand actions are stable across renders, which is what lets the gutter
  // extension — built once at editor mount — hold on to this one.
  const toggleBreakpoint = useLabStore(s => s.toggleBreakpoint)
  const handleChange = useDebouncedSetSource()
  // Shared modal for the lesson path + about page. `null` = closed.
  const [tab, setTab] = useState<string | null>(null)
  const editorHost = useRef<HTMLDivElement>(null)

  // Task 15: layout runs ONCE per compile (deps = compiled.revision, see
  // useLayout.ts) — scrubbing the timeline only changes `world` (via
  // selectWorld/stepIndex), it never touches ELK again. toReactFlow (Task 12)
  // is a pure function: it merges the fixed layout with the per-step world to
  // produce React Flow nodes/edges, without recomputing positions.
  const layout = useLayout(compiled)
  const graphData = toReactFlow(compiled.spec, layout, world)

  // Narration depends on the TRACE, not on the step — computed once per
  // compile. The memo here is to keep REFERENCE STABILITY (a new array on
  // every render would make NarrationPanel re-render for nothing), not
  // because narrateTrace is slow: it does a single pass.
  const narration = useMemo(() => narrateTrace(compiled.events), [compiled.events])

  // Built ONCE: CodeEditor reads extraExtensions at mount only (see its empty
  // deps array), so rebuilding this array later would be silently ignored.
  // Safe precisely because `toggleBreakpoint` is stable.
  const editorExtensions = useMemo(
    () => [...diagnosticMarks, ...breakpointGutter(toggleBreakpoint)], [toggleBreakpoint])

  const reachable = useMemo(() => [...linesInTrace(compiled.events)], [compiled.events])

  // Push diagnostics into diagnosticMarks (red gutter dot + underline)
  // whenever the list changes. The field/gutter are plugged in via
  // `extraExtensions` (already set up since Task 8) at mount time; here we
  // only dispatch DATA — the StateField clamps the line against the REAL doc
  // at the moment the effect runs (see diagnosticMarks.ts), so even if
  // `source` in the store lags a few characters behind the EditorView the
  // user is mid-typing in, it still never throws.
  useEffect(() => {
    const view = findEditorView(editorHost.current)
    if (!view) return
    view.dispatch({ effects: setDiagnosticLines.of(diagnostics.map(d => d.line)) })
  }, [diagnostics])

  // Store -> editor, one way. The gutter's click reports a line and nothing
  // else, so this dispatch is the only thing that ever changes what it draws.
  useEffect(() => {
    const view = findEditorView(editorHost.current)
    if (!view) return
    view.dispatch({ effects: setBreakpointLines.of(breakpoints) })
  }, [breakpoints])

  useEffect(() => {
    const view = findEditorView(editorHost.current)
    if (!view) return
    view.dispatch({ effects: setReachableLines.of(reachable) })
  }, [reachable])

  // Click a diagnostic in the panel -> scroll CodeEditor to that line. Clamp
  // AGAIN using the view's real doc at the moment of the click (don't just
  // trust the already-clamped number DiagnosticsPanel returns, which clamps
  // against the store's `source` — that can be out of sync with CodeMirror's
  // live doc while the debounce hasn't fired yet).
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
      nav={
        <LessonNav
          currentLessonId={lessonId}
          onOpenLessons={() => setTab('lessons')}
          onOpenAbout={() => setTab('about')}
          setSource={loadSource}
        />
      }
      editor={
        <div className="editor-col">
          {/* Above the editor, not in a side column: once you've read the
              model, your eyes go straight down to the code that embodies it. */}
          <MentalModel lessonId={lessonId} />
          <Panel title="Kotlin source" grow>
            <div ref={editorHost}>
              <CodeEditor
                value={source}
                onChange={handleChange}
                currentLine={currentLine}
                extraExtensions={editorExtensions}
              />
            </div>
          </Panel>
          {/* Errors sit RIGHT BELOW the code, not behind the debug button.
              Previously diagnostics only lived in the debug panel (closed by
              default), so learners saw a red-underlined line in the editor
              with not a single word explaining it — they knew it was wrong,
              not what was wrong. Only shows when there ARE errors: with clean
              code, the full height belongs to the editor. */}
          {diagnostics.length > 0 && (
            <Panel title={`${diagnostics.length} error(s) to fix`} tone="error">
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
        <Panel title="Coroutine graph" grow>
          <GraphStage
            graph={graphData}
            narration={narration}
            stepIndex={stepIndex}
            setStep={setStep}
            total={compiled.events.length}
            events={compiled.events}
            source={source}
            world={world}
            breakpoints={breakpoints}
          />
        </Panel>
      }
      timeline={
        <Panel title="Timeline">
          <Timeline events={compiled.events} stepIndex={stepIndex} setStep={setStep} />
          <PlaybackControls stepIndex={stepIndex} setStep={setStep} max={compiled.events.length} />
        </Panel>
      }
      side={
        <>
          <Panel title="What's happening" grow>
            <NarrationPanel lines={narration} stepIndex={stepIndex} onJump={setStep} />
          </Panel>
          {/* Diagnostics moved to the code column (right under the editor) —
              only the console is left here, so the same error doesn't show up
              in two places. */}
          <Panel title="Console">
            <ConsolePanel events={compiled.events} stepIndex={stepIndex} />
          </Panel>
        </>
      }
    />
    {tab !== null && (
      <Modal
        activeTab={tab}
        setTab={setTab}
        onClose={() => setTab(null)}
        tabs={[
          {
            id: 'lessons',
            label: `Lessons · ${LESSON_LIST.length}`,
            content: (
              <LessonList
                currentLessonId={lessonId}
                onPick={id => { loadLesson(id); setTab(null) }}
              />
            ),
          },
          {
            id: 'about',
            label: 'What can it run?',
            content: <AboutContent onOpenExample={src => { loadSource(src); setTab(null) }} />,
          },
        ]}
      />
    )}
    </>
  )
}
