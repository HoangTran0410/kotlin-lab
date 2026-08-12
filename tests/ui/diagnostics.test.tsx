import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DiagnosticsPanel } from '../../src/ui/diagnostics/DiagnosticsPanel'
import { runSourceSafe } from '../../src/engine/run'
import type { Diagnostic } from '../../src/engine/validator/diagnostics'

// brief task 10, Step 3, test 2/3: a REAL validator error (not hand-built), to
// confirm the hint actually exists on the Channel -> UNSUPPORTED path.
const CHANNEL_DIAGNOSTIC = runSourceSafe('fun main() = runBlocking { val c = Channel<Int>() }').diagnostics[0]!

// brief test 4: a PARSER error (not validator) from unfinished source — the
// toDiagnostic(ParseError/LexError) branch in run.ts does NOT attach a
// `hint`, unlike the validator branch above. This is the real check that the
// panel isn't blank when the hint is absent.
const UNFINISHED_DIAGNOSTIC = runSourceSafe('fun main() = runBlocking {\n  launch { del').diagnostics[0]!

describe('DiagnosticsPanel', () => {
  it('no errors shows the empty state', () => {
    render(<DiagnosticsPanel diagnostics={[]} docLines={1} onJumpToLine={() => {}} />)
    expect(screen.getByText('No errors. The code runs.')).toBeInTheDocument()
  })

  it('a validator error shows the message + line number', () => {
    render(<DiagnosticsPanel diagnostics={[CHANNEL_DIAGNOSTIC]} docLines={1} onJumpToLine={() => {}} />)
    expect(screen.getByText(CHANNEL_DIAGNOSTIC.message)).toBeInTheDocument()
    expect(screen.getByText(`line ${CHANNEL_DIAGNOSTIC.line}`)).toBeInTheDocument()
  })

  it('a validator error with a hint shows the hint', () => {
    expect(CHANNEL_DIAGNOSTIC.hint, 'fixture must actually have a hint for this test to mean anything').toBeDefined()
    render(<DiagnosticsPanel diagnostics={[CHANNEL_DIAGNOSTIC]} docLines={1} onJumpToLine={() => {}} />)
    expect(screen.getByText(CHANNEL_DIAGNOSTIC.hint!)).toBeInTheDocument()
  })

  it('a parser error from unfinished source shows up (panel isn\'t blank)', () => {
    expect(UNFINISHED_DIAGNOSTIC.hint, 'a parser error carries no hint — exactly the case worth checking').toBeUndefined()
    render(<DiagnosticsPanel diagnostics={[UNFINISHED_DIAGNOSTIC]} docLines={2} onJumpToLine={() => {}} />)
    expect(screen.queryByText('No errors. The code runs.')).not.toBeInTheDocument()
    expect(screen.getByText(UNFINISHED_DIAGNOSTIC.message)).toBeInTheDocument()
  })

  it('a line past the doc length gets clamped, does not throw', () => {
    const outOfRange: Diagnostic = { severity: 'error', message: 'error points past end of file', line: 9999, col: 1 }
    expect(() =>
      render(<DiagnosticsPanel diagnostics={[outOfRange]} docLines={5} onJumpToLine={() => {}} />),
    ).not.toThrow()
    expect(screen.getByText('line 5')).toBeInTheDocument()
    expect(screen.queryByText('line 9999')).not.toBeInTheDocument()
  })

  it('clicking a diagnostic calls the jump-to-line callback with the clamped line', () => {
    const outOfRange: Diagnostic = { severity: 'error', message: 'error points past end of file', line: 9999, col: 1 }
    const onJumpToLine = vi.fn()
    render(<DiagnosticsPanel diagnostics={[outOfRange]} docLines={5} onJumpToLine={onJumpToLine} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onJumpToLine).toHaveBeenCalledTimes(1)
    expect(onJumpToLine).toHaveBeenCalledWith(5)
  })

  it('multiple diagnostics all show, in the right order', () => {
    const many: Diagnostic[] = [
      { severity: 'error', message: 'first error', line: 2, col: 1 },
      { severity: 'error', message: 'second error', line: 5, col: 3, hint: 'second hint' },
      { severity: 'error', message: 'third error', line: 9, col: 1 },
    ]
    render(<DiagnosticsPanel diagnostics={many} docLines={20} onJumpToLine={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map(b => b.textContent)).toEqual([
      'line 2first error',
      'line 5second errorsecond hint',
      'line 9third error',
    ])
  })
})
