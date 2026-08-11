import { KEYWORDS, OPERATORS, type StringPart, type Token, type TokenKind } from './token'

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
        throw new Error(`Lexer: chú thích khối chưa được đóng, bắt đầu ở dòng ${l}, cột ${c}`)
      }
      advance(2)
      continue
    }

    if (ch === '-' && src[i + 1] === '>') { push('ARROW', '->'); advance(2); continue }

    // '..' PHẢI xét trước SINGLE, nếu không '.' bị nuốt thành DOT và toán tử
    // khoảng không bao giờ tới lượt được khớp.
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
        // '$' chỉ mở template khi theo sau là '{' hoặc ký tự bắt đầu định danh.
        // Nếu không ('giá 5$ thôi', '$5') thì nó là ký tự thường — nếu bỏ điều
        // kiện này sẽ sinh ra part expr rỗng và parser ở Task 3 sẽ chết.
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
              throw new Error(`Lexer: thiếu '}' đóng cho \${...} bắt đầu ở dòng ${sl}, cột ${sc}`)
            }
            parts.push({ type: 'expr', source: src.slice(start, i), line: sl, col: sc })
            advance(1) // dấu }
          } else {
            advance(1) // bỏ qua '$'
            // sl/sc lấy TRƯỚC vòng quét: part phải trỏ vào vị trí BẮT ĐẦU của
            // biểu thức, đồng nhất với nhánh ${...} ở trên.
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
        throw new Error(`Lexer: chuỗi chưa được đóng, bắt đầu ở dòng ${l}, cột ${c}`)
      }
      flush()
      advance(1) // dấu " đóng
      toks.push({ kind: 'STRING', text: '', line: l, col: c, parts })
      continue
    }

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
