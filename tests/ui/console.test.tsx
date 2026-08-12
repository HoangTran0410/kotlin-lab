import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConsolePanel } from '../../src/ui/console/ConsolePanel'
import { selectConsoleLines } from '../../src/state/selectors'
import { foldTrace } from '../../src/engine/trace/world'
import { runSourceSafe } from '../../src/engine/run'
import { lessonSource } from '../../src/lessons/registry'

const supervisor = runSourceSafe(lessonSource('supervisor')!)
const normalfail = runSourceSafe(lessonSource('normalfail')!)

// Hai lần println ở hai mốc t KHÁC NHAU (50 rồi 200) — supervisor/normalfail
// đều có t trùng nhau (500, 500) nên không kiểm được "không giảm dần" một
// cách có ý nghĩa. Fixture riêng cho test 6.
const TWO_TIMES_SRC =
  'fun main() = runBlocking {\n  launch { delay(50); println("sớm") }\n  launch { delay(200); println("muộn") }\n}\n'
const twoTimes = runSourceSafe(TWO_TIMES_SRC)

describe('ConsolePanel — console theo thời gian ảo', () => {
  it('trạng thái rỗng: "Chưa có output."', () => {
    render(<ConsolePanel events={[]} stepIndex={0} />)
    expect(screen.getByText('Chưa có output.')).toBeInTheDocument()
  })

  it('supervisor ở step cuối in đúng hai dòng', () => {
    expect(supervisor.diagnostics, 'fixture phải compile sạch').toEqual([])
    render(<ConsolePanel events={supervisor.events} stepIndex={supervisor.events.length} />)
    expect(screen.getByText('A xong')).toBeInTheDocument()
    expect(screen.getByText('C xong')).toBeInTheDocument()
    expect(screen.getAllByText(/^t=/)).toHaveLength(2)
  })

  it('normalfail ở step cuối in không dòng nào', () => {
    expect(normalfail.diagnostics, 'fixture phải compile sạch').toEqual([])
    expect(normalfail.events.length, 'fixture phải có event để test có ý nghĩa').toBeGreaterThan(0)
    render(<ConsolePanel events={normalfail.events} stepIndex={normalfail.events.length} />)
    expect(screen.getByText('Chưa có output.')).toBeInTheDocument()
    expect(screen.queryByText(/xong/)).not.toBeInTheDocument()
  })

  it('tua ngược thì dòng biến mất theo', () => {
    const printlnIdx = supervisor.events.findIndex(e => e.k === 'PRINTLN')
    expect(printlnIdx, 'fixture phải có PRINTLN để test có ý nghĩa').toBeGreaterThan(-1)

    const { rerender } = render(<ConsolePanel events={supervisor.events} stepIndex={supervisor.events.length} />)
    expect(screen.getByText('A xong')).toBeInTheDocument()
    expect(screen.getByText('C xong')).toBeInTheDocument()

    // Tua về TRƯỚC dòng PRINTLN đầu tiên: cả hai dòng phải biến mất, không
    // chỉ dòng thứ hai.
    rerender(<ConsolePanel events={supervisor.events} stepIndex={printlnIdx} />)
    expect(screen.queryByText('A xong')).not.toBeInTheDocument()
    expect(screen.queryByText('C xong')).not.toBeInTheDocument()
    expect(screen.getByText('Chưa có output.')).toBeInTheDocument()
  })

  it('selectConsoleLines khớp world.output ở mọi step', () => {
    for (const r of [supervisor, normalfail, twoTimes]) {
      for (let n = 0; n <= r.events.length; n++) {
        const lines = selectConsoleLines(r.events, n)
        const world = foldTrace(r.events, n)
        expect(lines.map(l => l.text), `step ${n}`).toEqual(world.output)
      }
    }
  })

  it('mốc t không giảm dần', () => {
    expect(twoTimes.diagnostics, 'fixture phải compile sạch').toEqual([])
    const lines = selectConsoleLines(twoTimes.events, twoTimes.events.length)
    expect(lines.length, 'fixture phải có ít nhất hai dòng để test có ý nghĩa').toBeGreaterThanOrEqual(2)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]!.t).toBeGreaterThanOrEqual(lines[i - 1]!.t)
    }
    // Ghim rằng fixture THẬT SỰ có hai mốc t khác nhau, không phải trùng hợp
    // đơn điệu vì mọi t bằng nhau.
    expect(new Set(lines.map(l => l.t)).size).toBeGreaterThan(1)
  })
})
