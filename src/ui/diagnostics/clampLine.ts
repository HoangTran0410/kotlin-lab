/**
 * Clamps a 1-based line number into [1, totalLines].
 *
 * `Diagnostic.line` isn't trustworthy: leftover item B2 produces a wrong
 * `line: 1` for errors inside a string template "${...}", and a stale trace
 * (not yet recompiled) can point past the end of the file right after the
 * user deletes a few lines. Use EXACTLY this one function at both places that
 * need clamping — DiagnosticsPanel (shows the number + jumps to it) and
 * diagnosticMarks (gutter + underline in CodeEditor) — so there's no path
 * left that forgets to clamp.
 *
 * `totalLines` must always be >= 1 (even an empty document has exactly 1
 * logical line, matching CodeMirror's `Text.lines` and
 * `source.split('\n').length`).
 */
export function clampDiagnosticLine(line: number, totalLines: number): number {
  return Math.max(1, Math.min(line, totalLines))
}
