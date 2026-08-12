import { StreamLanguage } from '@codemirror/language'
import { kotlin } from '@codemirror/legacy-modes/mode/clike'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'

/**
 * `@replit/codemirror-lang-kotlin` does NOT exist on npm (checked the
 * registry during planning). Verified replacement:
 * @codemirror/legacy-modes@6.5.3 has `mode/clike.d.ts:28` declaring
 * `export declare const kotlin: StreamParser<unknown>`.
 *
 * StreamLanguage highlights line by line, it doesn't build a Lezer tree —
 * meaning no structural folding and no smart indentation. M2 needs neither;
 * REAL parsing is already done by the engine's own parser, and errors surface
 * through DiagnosticsPanel, not through the editor.
 */
export const kotlinExtensions: Extension[] = [StreamLanguage.define(kotlin), oneDark]
