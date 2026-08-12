import { KEYWORDS, OPERATORS, type StringPart, type Token, type TokenKind } from './token'
import type { Pos } from '../ast/nodes'

/**
 * Lexer errors MUST carry a structured position. The four spots below used to
 * throw a bare `Error` with the line/column stuffed into the message string —
 * DiagnosticsPanel had nothing to jump to, and the only way to recover the
 * position was to regex the message text apart. Type it properly, don't parse
 * the string.
 */
export class LexError extends Error {
  constructor(message: string, readonly pos: Pos) { super(message) }
}

const SINGLE: Record<string, TokenKind> = {
  '(': 'LPAREN', ')': 'RPAREN', '{': 'LBRACE', '}': 'RBRACE',
  ',': 'COMMA', '.': 'DOT', ':': 'COLON', ';': 'SEMI',
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = []
  let i = 0, line = 1, col = 1

  const push = (kind: TokenKind, text: string, l = line, c = col) =>
    toks.push({ kind, text, line: l, col: c })

  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1 } else { col++ }
      i++
    }
  }

  while (i < src.length) {
    const ch = src[i]!

    if (ch === '\n') { push('NEWLINE', '\n'); advance(1); continue }
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(1); continue }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') advance(1)
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const l = line, c = col
      advance(2)
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance(1)
      if (i >= src.length) {
        throw new LexError(`Lexer: unterminated block comment, starting at line ${l}, column ${c}`, { line: l, col: c })
      }
      advance(2)
      continue
    }

    if (ch === '-' && src[i + 1] === '>') { push('ARROW', '->'); advance(2); continue }

    // '..' MUST be checked before SINGLE, otherwise '.' gets swallowed as DOT
    // and the range operator never gets a chance to match.
    if (ch === '.' && src[i + 1] === '.') { push('OP', '..'); advance(2); continue }

    const single = SINGLE[ch]
    if (single) { push(single, ch); advance(1); continue }

    if (ch === '"') {
      const l = line, c = col
      advance(1)
      const parts: StringPart[] = []
      let text = ''
      const flush = () => { if (text) { parts.push({ type: 'text', value: text }); text = '' } }

      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          const esc = src[i + 1]
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', $: '$' }
          text += map[esc ?? ''] ?? esc ?? ''
          advance(2)
          continue
        }
        // '$' only opens a template when followed by '{' or an identifier-start
        // character. Otherwise ('costs 5$ only', '$5') it's a plain character —
        // dropping this condition would produce an empty expr part and the
        // parser in Task 3 would blow up.
        if (src[i] === '$' && (src[i + 1] === '{' || /[A-Za-z_]/.test(src[i + 1] ?? ''))) {
          flush()
          if (src[i + 1] === '{') {
            advance(2)
            const sl = line, sc = col
            const start = i
            let depth = 1
            while (i < src.length && depth > 0) {
              if (src[i] === '{') depth++
              else if (src[i] === '}') { depth--; if (depth === 0) break }
              advance(1)
            }
            if (depth > 0) {
              throw new LexError(`Lexer: missing closing '}' for \${...} starting at line ${sl}, column ${sc}`, { line: sl, col: sc })
            }
            parts.push({ type: 'expr', source: src.slice(start, i), line: sl, col: sc })
            advance(1) // the closing }
          } else {
            advance(1) // skip past '$'
            // sl/sc are captured BEFORE the scan loop: the part must point at the
            // START position of the expression, consistent with the ${...} branch above.
            const sl = line, sc = col
            const start = i
            while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) advance(1)
            parts.push({ type: 'expr', source: src.slice(start, i), line: sl, col: sc })
          }
          continue
        }
        text += src[i]
        advance(1)
      }
      if (i >= src.length) {
        throw new LexError(`Lexer: unterminated string, starting at line ${l}, column ${c}`, { line: l, col: c })
      }
      flush()
      advance(1) // closing " mark
      toks.push({ kind: 'STRING', text: '', line: l, col: c, parts })
      continue
    }

    if (/[0-9]/.test(ch)) {
      const start = i, l = line, c = col
      while (i < src.length && /[0-9_]/.test(src[i]!)) advance(1)
      // Only consume the decimal point when it's FOLLOWED by a digit. Scanning
      // '.' greedily would turn '1..3' into a single NUMBER token "1..3", and
      // for (i in 1..3) would never parse.
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        advance(1)
        while (i < src.length && /[0-9_]/.test(src[i]!)) advance(1)
      }
      push('NUMBER', src.slice(start, i).replace(/_/g, ''), l, c)
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i, l = line, c = col
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) advance(1)
      const text = src.slice(start, i)
      push(KEYWORDS.has(text) ? 'KEYWORD' : 'IDENT', text, l, c)
      continue
    }

    const op = OPERATORS.find(o => src.startsWith(o, i))
    if (op) { push('OP', op); advance(op.length); continue }

    throw new LexError(`Lexer: unrecognized character '${ch}' at line ${line}, column ${col}`, { line, col })
  }

  push('EOF', '')
  return toks
}
