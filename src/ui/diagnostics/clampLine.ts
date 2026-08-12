/**
 * Kẹp một số dòng 1-based vào [1, totalLines].
 *
 * `Diagnostic.line` không đáng tin: tồn đọng B2 sinh ra `line: 1` sai cho lỗi
 * bên trong string template "${...}", và một trace cũ (chưa biên dịch lại)
 * có thể trỏ quá cuối file sau khi user vừa xoá vài dòng. Dùng ĐÚNG một hàm
 * này ở cả hai nơi cần kẹp — DiagnosticsPanel (hiện số + nhảy dòng) và
 * diagnosticMarks (gutter + gạch chân trong CodeEditor) — để không có đường
 * nào quên kẹp.
 *
 * `totalLines` luôn phải >= 1 (kể cả tài liệu rỗng vẫn có đúng 1 dòng logic,
 * giống `Text.lines` của CodeMirror và `source.split('\n').length`).
 */
export function clampDiagnosticLine(line: number, totalLines: number): number {
  return Math.max(1, Math.min(line, totalLines))
}
