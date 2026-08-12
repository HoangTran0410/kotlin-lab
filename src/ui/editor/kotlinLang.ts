import { StreamLanguage } from '@codemirror/language'
import { kotlin } from '@codemirror/legacy-modes/mode/clike'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'

/**
 * `@replit/codemirror-lang-kotlin` KHÔNG tồn tại trên npm (đã tra registry lúc
 * lập kế hoạch). Bản thay thế đã xác minh: @codemirror/legacy-modes@6.5.3 có
 * `mode/clike.d.ts:28` khai báo `export declare const kotlin: StreamParser<unknown>`.
 *
 * StreamLanguage tô màu theo dòng, không dựng cây Lezer — nghĩa là không có
 * fold theo cấu trúc và không có indent thông minh. M2 không cần cả hai; phân
 * tích cú pháp THẬT đã do parser của engine làm rồi, và lỗi hiện qua
 * DiagnosticsPanel chứ không qua editor.
 */
export const kotlinExtensions: Extension[] = [StreamLanguage.define(kotlin), oneDark]
