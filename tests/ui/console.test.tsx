import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConsolePanel } from '../../src/ui/console/ConsolePanel'
import { selectConsoleLines } from '../../src/state/selectors'
import { foldTrace } from '../../src/engine/trace/world'
import { runSourceSafe } from '../../src/engine/run'
import { lessonSource } from '../../src/lessons/registry'

const supervisor = runSourceSafe(lessonSource('supervisor')!)
const normalfail = runSourceSafe(lessonSource('normalfail')!)

// Two printlns at two DIFFERENT t marks (50 then 200) — supervisor/normalfail
// both have matching t values (500, 500), so "non-decreasing" can't be
// checked meaningfully with them. Dedicated fixture for test 6.
const TWO_TIMES_SRC =
  'fun main() = runBlocking {\n  launch { delay(50); println("early") }\n  launch { delay(200); println("late") }\n}\n'
const twoTimes = runSourceSafe(TWO_TIMES_SRC)

describe('ConsolePanel — console on virtual time', () => {
  it('empty state: "No output yet."', () => {
    render(<ConsolePanel events={[]} stepIndex={0} />)
    expect(screen.getByText('No output yet.')).toBeInTheDocument()
  })

  // 'A done' / 'C done' are println output from the
  // 'supervisor' lesson fixture (src/lessons/*), which is out of this
  // agent's scope — the lessons agent owns that content and will translate
  // it independently. Left as-is here; integrator must update these two
  // literals (and the /xong/ regex below) to match the lesson's translated
  // output once that lands.
  it('supervisor at the final step prints exactly two lines', () => {
    expect(supervisor.diagnostics, 'fixture must compile clean').toEqual([])
    render(<ConsolePanel events={supervisor.events} stepIndex={supervisor.events.length} />)
    expect(screen.getByText('A done')).toBeInTheDocument()
    expect(screen.getByText('C done')).toBeInTheDocument()
    expect(screen.getAllByText(/^t=/)).toHaveLength(2)
  })

  it('normalfail at the final step prints no lines', () => {
    expect(normalfail.diagnostics, 'fixture must compile clean').toEqual([])
    expect(normalfail.events.length, 'fixture must have events for this test to mean anything').toBeGreaterThan(0)
    render(<ConsolePanel events={normalfail.events} stepIndex={normalfail.events.length} />)
    expect(screen.getByText('No output yet.')).toBeInTheDocument()
    expect(screen.queryByText(/xong/)).not.toBeInTheDocument()
  })

  it('scrubbing backwards makes lines disappear along with it', () => {
    const printlnIdx = supervisor.events.findIndex(e => e.k === 'PRINTLN')
    expect(printlnIdx, 'fixture must have a PRINTLN for this test to mean anything').toBeGreaterThan(-1)

    const { rerender } = render(<ConsolePanel events={supervisor.events} stepIndex={supervisor.events.length} />)
    expect(screen.getByText('A done')).toBeInTheDocument()
    expect(screen.getByText('C done')).toBeInTheDocument()

    // Scrub back to BEFORE the first PRINTLN line: both lines must disappear,
    // not just the second one.
    rerender(<ConsolePanel events={supervisor.events} stepIndex={printlnIdx} />)
    expect(screen.queryByText('A done')).not.toBeInTheDocument()
    expect(screen.queryByText('C done')).not.toBeInTheDocument()
    expect(screen.getByText('No output yet.')).toBeInTheDocument()
  })

  it('selectConsoleLines matches world.output at every step', () => {
    for (const r of [supervisor, normalfail, twoTimes]) {
      for (let n = 0; n <= r.events.length; n++) {
        const lines = selectConsoleLines(r.events, n)
        const world = foldTrace(r.events, n)
        expect(lines.map(l => l.text), `step ${n}`).toEqual(world.output)
      }
    }
  })

  it('t marks are non-decreasing', () => {
    expect(twoTimes.diagnostics, 'fixture must compile clean').toEqual([])
    const lines = selectConsoleLines(twoTimes.events, twoTimes.events.length)
    expect(lines.length, 'fixture must have at least two lines for this test to mean anything').toBeGreaterThanOrEqual(2)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]!.t).toBeGreaterThanOrEqual(lines[i - 1]!.t)
    }
    // Pin down that the fixture ACTUALLY has two different t marks, not a
    // trivial monotonic pass because every t is equal.
    expect(new Set(lines.map(l => l.t)).size).toBeGreaterThan(1)
  })
})
