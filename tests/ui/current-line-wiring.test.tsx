import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { highlightedLine } from './support/highlightedLine'

/**
 * "Nối dây" (Step 3 của brief task 9) không có test tự động nào trong brief —
 * chỉ `npm run dev` thủ công, mở lesson và "kéo timeline". Chưa có timeline
 * slider nào được dựng tới task này (Panel timeline vẫn là placeholder ở
 * App.tsx), nên bài kiểm ở đây lái store thật qua `setStep` — đúng cơ chế mà
 * một thanh kéo timeline ở task sau sẽ gọi.
 *
 * Tách file riêng (không nằm trong current-line.test.ts) vì brief ghi rõ file
 * đó "Test thuần, không cần render React" — còn test này CẦN render <App />.
 *
 * Lý do thêm test này dù brief không yêu cầu: task 8 (debounce) từng lọt lưới
 * CHÍNH VÌ mọi test khi đó chỉ render CodeEditor trực tiếp, không qua App —
 * hành vi "prop currentLine THẬT SỰ chảy từ store xuống EditorView" chỉ tồn
 * tại khi App và CodeEditor được ghép lại. currentLine.test.ts (Step 2) không
 * thể bắt lỗi kiểu "App quên đọc selectCurrentLine" hay "App quên truyền prop
 * currentLine" — cả hai đều để lại field currentLineField hoạt động đúng khi
 * bị gọi trực tiếp, tests đó vẫn xanh.
 */
describe('nối dây App -> CodeEditor — highlight đi theo stepIndex thật của store', () => {
  it('kéo stepIndex qua store làm dòng highlight trong EditorView di chuyển theo', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)
    const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('không tìm thấy EditorView trong DOM')

    // Đo trước khi viết ngưỡng (tests/engine/trace-srcline.test.ts dùng cùng
    // nguồn 'supervisor'; đo tay lại ở đây): trace của lesson này có 64 event,
    // đi qua đúng 3 dòng khác nhau (3, 4, 5).
    const n = useLabStore.getState().compiled.events.length
    expect(n, 'fixture supervisor phải có event để bước qua thì test mới có ý nghĩa').toBeGreaterThan(0)

    const seen = new Set<number | null>()
    for (let i = 0; i <= n; i++) {
      act(() => { useLabStore.getState().setStep(i) })
      seen.add(highlightedLine(view.state))
    }

    const distinctLines = [...seen].filter((l): l is number => l !== null)
    expect(new Set(distinctLines).size, 'phải thấy nhiều hơn 1 dòng khi tua hết trace').toBeGreaterThan(1)
    // Suy từ SOURCE thật, không chép số cứng: thêm một dòng `import` vào đầu
    // lesson là mọi số dòng chép tay lệch đi, và test sẽ đỏ vì lý do chẳng
    // liên quan gì tới thứ nó canh (wiring highlight <-> stepIndex).
    const src = lessonSource('supervisor')!.split('\n')
    const dongLaunch = src
      .map((l, i) => (l.includes('launch {') ? i + 1 : -1))
      .filter(n => n > 0)
    expect(dongLaunch.length, 'lesson supervisor phải có 3 dòng launch').toBe(3)
    expect(new Set(distinctLines)).toEqual(new Set(dongLaunch))
  })

  it('step 0 chưa có event nào thì chưa có gì được tô', () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    const { container } = render(<App />)
    const host = container.querySelector('[data-testid="code-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('không tìm thấy EditorView trong DOM')
    expect(highlightedLine(view.state)).toBeNull()
  })
})
