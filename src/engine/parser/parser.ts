import { tokenize } from '../lexer/lexer'
import type { StringPart, Token } from '../lexer/token'
import type {
  Arg, Block, Expr, Pos, Program, StringPartNode,
} from '../ast/nodes'

/** Độ ưu tiên càng cao càng bám chặt. */
const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
}

export class ParseError extends Error {
  constructor(message: string, readonly pos: Pos) { super(message) }
}

export class Parser {
  private i = 0
  constructor(private readonly toks: Token[]) {}

  // ---- tiện ích ----
  private peek(offset = 0): Token {
    let j = this.i, seen = 0
    while (j < this.toks.length) {
      if (this.toks[j]!.kind !== 'NEWLINE') {
        if (seen === offset) return this.toks[j]!
        seen++
      }
      j++
    }
    return this.toks[this.toks.length - 1]!
  }

  /** Token kế tiếp, KHÔNG bỏ qua xuống dòng. Dùng khi xuống dòng có nghĩa. */
  private peekRaw(): Token { return this.toks[this.i] ?? this.toks[this.toks.length - 1]! }

  private next(): Token {
    while (this.toks[this.i]?.kind === 'NEWLINE') this.i++
    return this.toks[this.i++] ?? this.toks[this.toks.length - 1]!
  }

  private at(kind: Token['kind'], text?: string): boolean {
    const t = this.peek()
    return t.kind === kind && (text === undefined || t.text === text)
  }

  private accept(kind: Token['kind'], text?: string): boolean {
    if (this.at(kind, text)) { this.next(); return true }
    return false
  }

  private expect(kind: Token['kind'], text?: string): Token {
    if (!this.at(kind, text)) {
      const t = this.peek()
      throw new ParseError(
        `Mong đợi ${text ?? kind} nhưng gặp '${t.text || t.kind}'`,
        { line: t.line, col: t.col },
      )
    }
    return this.next()
  }

  private posOf(t: Token): Pos { return { line: t.line, col: t.col } }

  skipNewlines(): void { while (this.toks[this.i]?.kind === 'NEWLINE') this.i++ }
  atEof(): boolean { return this.peek().kind === 'EOF' }

  // ---- biểu thức ----
  parseExpr(): Expr { return this.parseBinary(0) }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseRange()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'OP') break
      const prec = BINARY_PRECEDENCE[t.text]
      if (prec === undefined || prec < minPrec) break
      this.next()
      const right = this.parseBinary(prec + 1)
      left = { k: 'Binary', op: t.text, left, right, pos: this.posOf(t) }
    }
    return left
  }

  private parseRange(): Expr {
    const from = this.parseUnary()
    if (this.at('OP', '..')) {
      const t = this.next()
      return { k: 'Range', from, to: this.parseUnary(), pos: this.posOf(t) }
    }
    return from
  }

  private parseUnary(): Expr {
    const t = this.peek()
    if (t.kind === 'OP' && (t.text === '-' || t.text === '!')) {
      this.next()
      return { k: 'Unary', op: t.text, operand: this.parseUnary(), pos: this.posOf(t) }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary()
    for (;;) {
      if (this.at('DOT') || this.at('OP', '?.')) {
        this.next()
        const name = this.expect('IDENT')
        expr = { k: 'Member', target: expr, name: name.text, pos: this.posOf(name) }
      } else if (this.at('LPAREN')) {
        expr = this.parseCallTail(expr)
      } else {
        break
      }
    }
    return expr
  }

  /** Task 4 sẽ mở rộng để nuốt trailing lambda. */
  protected parseCallTail(callee: Expr): Expr {
    const lp = this.expect('LPAREN')
    const args: Arg[] = []
    while (!this.at('RPAREN')) {
      args.push(this.parseArg())
      if (!this.accept('COMMA')) break
    }
    this.expect('RPAREN')
    return { k: 'Call', callee, args, lambda: null, pos: this.posOf(lp) }
  }

  private parseArg(): Arg {
    if (this.peek().kind === 'IDENT' && this.peek(1).kind === 'OP' && this.peek(1).text === '=') {
      const name = this.next().text
      this.next()
      return { name, value: this.parseExpr() }
    }
    return { name: null, value: this.parseExpr() }
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    const pos = this.posOf(t)

    if (t.kind === 'NUMBER') { this.next(); return { k: 'NumberLit', value: Number(t.text), pos } }
    if (t.kind === 'STRING') { this.next(); return { k: 'StringLit', parts: this.stringParts(t.parts ?? []), pos } }
    if (t.kind === 'KEYWORD' && t.text === 'true') { this.next(); return { k: 'BoolLit', value: true, pos } }
    if (t.kind === 'KEYWORD' && t.text === 'false') { this.next(); return { k: 'BoolLit', value: false, pos } }
    if (t.kind === 'KEYWORD' && t.text === 'null') { this.next(); return { k: 'NullLit', pos } }
    if (t.kind === 'IDENT') { this.next(); return { k: 'Ident', name: t.text, pos } }

    if (t.kind === 'LPAREN') {
      this.next()
      const inner = this.parseExpr()
      this.expect('RPAREN')
      return inner
    }

    throw new ParseError(`Không phân tích được biểu thức bắt đầu bằng '${t.text || t.kind}'`, pos)
  }

  private stringParts(parts: StringPart[]): StringPartNode[] {
    return parts.map(p => p.type === 'text'
      ? { type: 'text' as const, value: p.value }
      : { type: 'expr' as const, expr: new Parser(tokenize(p.source)).parseExpr() })
  }

  // Task 5 cài parseBlock/parseStmt; Task 6 cài parseProgram.
  parseBlock(): Block { throw new ParseError('parseBlock chưa cài — Task 5', { line: 0, col: 0 }) }
}

export function parseExprSource(src: string): Expr {
  return new Parser(tokenize(src)).parseExpr()
}

export function parseProgram(_src: string): Program {
  void _src // tham số giữ đúng chữ ký cho Task 6; chưa dùng ở Task 3
  throw new ParseError('parseProgram chưa cài — Task 6', { line: 0, col: 0 })
}
