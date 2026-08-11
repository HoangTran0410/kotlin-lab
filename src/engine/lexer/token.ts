export type TokenKind =
  | 'IDENT' | 'KEYWORD' | 'NUMBER' | 'STRING' | 'OP'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE'
  | 'COMMA' | 'DOT' | 'COLON' | 'SEMI' | 'ARROW' | 'NEWLINE' | 'EOF'

export type StringPart =
  | { type: 'text'; value: string }
  | { type: 'expr'; source: string; line: number; col: number }

export interface Token {
  kind: TokenKind
  text: string
  line: number
  col: number
  /** Chỉ có ở token STRING. */
  parts?: StringPart[]
}

export const KEYWORDS = new Set([
  'val', 'var', 'fun', 'suspend', 'if', 'else', 'while', 'for', 'in',
  'try', 'catch', 'finally', 'throw', 'return', 'when', 'true', 'false', 'null', 'import',
])

/** Toán tử nhiều ký tự phải đứng trước toán tử ngắn hơn để khớp tham lam. */
export const OPERATORS = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '..', '?:', '?.',
  '+=', '-=', '*=', '/=', '=', '<', '>', '+', '-', '*', '/', '%', '!', '?',
]
