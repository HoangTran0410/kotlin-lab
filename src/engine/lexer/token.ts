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
  /** Only present on STRING tokens. */
  parts?: StringPart[]
}

export const KEYWORDS = new Set([
  'val', 'var', 'fun', 'suspend', 'if', 'else', 'while', 'for', 'in',
  'try', 'catch', 'finally', 'throw', 'return', 'when', 'true', 'false', 'null', 'import',
])

/** Multi-character operators must come before shorter ones so greedy matching works. */
export const OPERATORS = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '..', '?:', '?.',
  '+=', '-=', '*=', '/=', '=', '<', '>', '+', '-', '*', '/', '%', '!', '?',
]
