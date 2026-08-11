import { KEYWORDS, OPERATORS, type Token, type TokenKind } from './token'

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

    if (ch === '-' && src[i + 1] === '>') { push('ARROW', '->'); advance(2); continue }

    // '..' PHẢI xét trước SINGLE, nếu không '.' bị nuốt thành DOT và toán tử
    // khoảng không bao giờ tới lượt được khớp.
    if (ch === '.' && src[i + 1] === '.') { push('OP', '..'); advance(2); continue }

    const single = SINGLE[ch]
    if (single) { push(single, ch); advance(1); continue }

    if (/[0-9]/.test(ch)) {
      const start = i, l = line, c = col
      while (i < src.length && /[0-9_]/.test(src[i]!)) advance(1)
      // Chỉ nuốt dấu chấm thập phân khi SAU nó là chữ số. Nếu quét cả '.' một
      // cách tham lam thì '1..3' biến thành một token NUMBER "1..3" và vòng
      // for (i in 1..3) không bao giờ parse được.
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

    throw new Error(`Lexer: ký tự không nhận diện được '${ch}' tại dòng ${line}, cột ${col}`)
  }

  push('EOF', '')
  return toks
}
