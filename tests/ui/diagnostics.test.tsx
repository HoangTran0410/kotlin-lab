import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DiagnosticsPanel } from '../../src/ui/diagnostics/DiagnosticsPanel'
import { runSourceSafe } from '../../src/engine/run'
import type { Diagnostic } from '../../src/engine/validator/diagnostics'

// brief task 10, Step 3, test 2/3: lỗi validator THẬT (không dựng tay), để
// khẳng định hint thật sự tồn tại trên đường Channel -> UNSUPPORTED.
const CHANNEL_DIAGNOSTIC = runSourceSafe('fun main() = runBlocking { val c = Channel<Int>() }').diagnostics[0]!

// brief test 4: lỗi PARSER (không phải validator) từ source dở dang — nhánh
// toDiagnostic(ParseError/LexError) trong run.ts KHÔNG gắn `hint`, khác hẳn
// nhánh validator ở trên. Đây là ca thật sự kiểm "panel không trắng" khi
// hint vắng mặt.
const UNFINISHED_DIAGNOSTIC = runSourceSafe('fun main() = runBlocking {\n  launch { del').diagnostics[0]!

describe('DiagnosticsPanel', () => {
  it('không có lỗi thì hiện trạng thái rỗng', () => {
    render(<DiagnosticsPanel diagnostics={[]} docLines={1} onJumpToLine={() => {}} />)
    expect(screen.getByText('Không có lỗi. Code chạy được.')).toBeInTheDocument()
  })

  it('lỗi validator hiện thông điệp + số dòng', () => {
    render(<DiagnosticsPanel diagnostics={[CHANNEL_DIAGNOSTIC]} docLines={1} onJumpToLine={() => {}} />)
    expect(screen.getByText(CHANNEL_DIAGNOSTIC.message)).toBeInTheDocument()
    expect(screen.getByText(`dòng ${CHANNEL_DIAGNOSTIC.line}`)).toBeInTheDocument()
  })

  it('lỗi validator có hint thì hiện hint', () => {
    expect(CHANNEL_DIAGNOSTIC.hint, 'fixture phải thật sự có hint để test có ý nghĩa').toBeDefined()
    render(<DiagnosticsPanel diagnostics={[CHANNEL_DIAGNOSTIC]} docLines={1} onJumpToLine={() => {}} />)
    expect(screen.getByText(CHANNEL_DIAGNOSTIC.hint!)).toBeInTheDocument()
  })

  it('lỗi parser từ source dở dang hiện ra được (không trắng panel)', () => {
    expect(UNFINISHED_DIAGNOSTIC.hint, 'lỗi parser không mang hint — đúng là ca cần kiểm').toBeUndefined()
    render(<DiagnosticsPanel diagnostics={[UNFINISHED_DIAGNOSTIC]} docLines={2} onJumpToLine={() => {}} />)
    expect(screen.queryByText('Không có lỗi. Code chạy được.')).not.toBeInTheDocument()
    expect(screen.getByText(UNFINISHED_DIAGNOSTIC.message)).toBeInTheDocument()
  })

  it('line vượt quá số dòng bị kẹp, không ném', () => {
    const outOfRange: Diagnostic = { severity: 'error', message: 'lỗi trỏ ra ngoài file', line: 9999, col: 1 }
    expect(() =>
      render(<DiagnosticsPanel diagnostics={[outOfRange]} docLines={5} onJumpToLine={() => {}} />),
    ).not.toThrow()
    expect(screen.getByText('dòng 5')).toBeInTheDocument()
    expect(screen.queryByText('dòng 9999')).not.toBeInTheDocument()
  })

  it('bấm vào diagnostic gọi callback nhảy dòng với số dòng đã kẹp', () => {
    const outOfRange: Diagnostic = { severity: 'error', message: 'lỗi trỏ ra ngoài file', line: 9999, col: 1 }
    const onJumpToLine = vi.fn()
    render(<DiagnosticsPanel diagnostics={[outOfRange]} docLines={5} onJumpToLine={onJumpToLine} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onJumpToLine).toHaveBeenCalledTimes(1)
    expect(onJumpToLine).toHaveBeenCalledWith(5)
  })

  it('nhiều diagnostic hiện đủ, đúng thứ tự', () => {
    const many: Diagnostic[] = [
      { severity: 'error', message: 'lỗi thứ nhất', line: 2, col: 1 },
      { severity: 'error', message: 'lỗi thứ hai', line: 5, col: 3, hint: 'gợi ý thứ hai' },
      { severity: 'error', message: 'lỗi thứ ba', line: 9, col: 1 },
    ]
    render(<DiagnosticsPanel diagnostics={many} docLines={20} onJumpToLine={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map(b => b.textContent)).toEqual([
      'dòng 2lỗi thứ nhất',
      'dòng 5lỗi thứ haigợi ý thứ hai',
      'dòng 9lỗi thứ ba',
    ])
  })
})
