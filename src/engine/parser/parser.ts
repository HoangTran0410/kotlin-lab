import { tokenize } from '../lexer/lexer'
import type { StringPart, Token } from '../lexer/token'
// Chỉ import kiểu thực sự dùng ở task này. Task 4 thêm Lambda, Task 5 thêm
// CatchClause/WhenBranch, Task 6 thêm FunDecl/Param — thêm khi cần.
import type { Arg, Block, CatchClause, Expr, FunDecl, Lambda, Param, Pos, Program, Stmt, StringPartNode, WhenBranch } from '../ast/nodes'

/**
 * Độ ưu tiên càng cao càng bám chặt. Thứ tự theo đúng Kotlin.
 *
 * Chú ý '..': trong Kotlin nó LỎNG HƠN cộng/trừ và CHẶT HƠN so sánh.
 * Nếu cho '..' bám chặt hơn số học thì `1..n-1` — idiom range phổ biến nhất —
 * sẽ parse thành `(1..n)-1` thay vì `1..(n-1)`.
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '..': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
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

  /**
   * Token kế tiếp có đúng loại `kind` VÀ nằm cùng dòng với vị trí hiện tại?
   * Dùng cho trailing lambda: `foo()` rồi xuống dòng mới `{ ... }` là một khối
   * riêng, không phải lambda của foo. Nếu bỏ điều kiện cùng dòng thì
   * `val x = f()` theo sau bởi một block sẽ bị nuốt nhầm.
   */
  private atSameLine(kind: Token['kind']): boolean {
    const next = this.toks[this.i]
    if (!next || next.kind === 'NEWLINE') return false
    return next.kind === kind
  }

  // ---- biểu thức ----
  parseExpr(): Expr { return this.parseBinary(0) }

  /** Precedence climbing. `prec + 1` cho toán hạng phải ⇒ kết hợp trái. */
  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'OP') break
      const prec = BINARY_PRECEDENCE[t.text]
      if (prec === undefined || prec < minPrec) break
      this.next()
      const right = this.parseBinary(prec + 1)
      // '..' đi chung bảng ưu tiên với toán tử nhị phân nhưng dựng ra node
      // Range riêng — nhờ vậy ưu tiên đúng Kotlin mà AST vẫn tách bạch.
      left = t.text === '..'
        ? { k: 'Range', from: left, to: right, pos: this.posOf(t) }
        : { k: 'Binary', op: t.text, left, right, pos: this.posOf(t) }
    }
    return left
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
      } else if (this.trySkipTypeArgs()) {
        // Đã nuốt <...>; vòng lặp kế sẽ thấy '(' và gọi parseCallTail.
      } else if (this.at('LPAREN')) {
        expr = this.parseCallTail(expr)
      } else if (this.atSameLine('LBRACE')) {
        const lambda = this.parseLambda()
        expr = expr.k === 'Call' && expr.lambda === null
          ? { ...expr, lambda }
          : { k: 'Call', callee: expr, args: [], lambda, pos: lambda.pos }
      } else {
        break
      }
    }
    return expr
  }

  /**
   * Phân biệt `Channel<Int>()` (đối số kiểu) với `a < b` (so sánh).
   *
   * Chỉ coi là đối số kiểu khi quét được tới '>' khớp cặp VÀ ngay sau đó là
   * '('. Nhờ điều kiện thứ hai mà `a < b` không bao giờ bị hiểu nhầm. Thất bại
   * thì khôi phục con trỏ về chỗ cũ, không để lại dấu vết.
   */
  private trySkipTypeArgs(): boolean {
    if (!this.at('OP', '<')) return false
    const save = this.i
    this.next()
    let depth = 1
    while (depth > 0) {
      if (this.atEof()) { this.i = save; return false }
      if (this.at('OP', '<')) { depth++; this.next(); continue }
      if (this.at('OP', '>')) { depth--; this.next(); continue }
      // Bên trong đối số kiểu chỉ chấp nhận tên, dấu phẩy, chấm, dấu hỏi.
      if (this.at('IDENT') || this.at('COMMA') || this.at('DOT') || this.at('OP', '?')) {
        this.next(); continue
      }
      this.i = save
      return false
    }
    if (this.at('LPAREN')) return true
    this.i = save
    return false
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

    if (t.kind === 'KEYWORD' && t.text === 'if') {
      this.next()
      this.expect('LPAREN')
      const cond = this.parseExpr()
      this.expect('RPAREN')
      const thenBlock = this.parseBlock()
      const elseBlock = this.accept('KEYWORD', 'else') ? this.parseBlock() : null
      return { k: 'IfExpr', cond, thenBlock, elseBlock, pos }
    }

    if (t.kind === 'KEYWORD' && t.text === 'when') {
      this.next()
      let subject: Expr | null = null
      if (this.accept('LPAREN')) { subject = this.parseExpr(); this.expect('RPAREN') }
      this.expect('LBRACE')
      this.skipNewlines()
      const branches: WhenBranch[] = []
      let elseBlock: Block | null = null
      while (!this.at('RBRACE') && !this.atEof()) {
        if (this.accept('KEYWORD', 'else')) {
          this.expect('ARROW')
          elseBlock = this.parseBlock()
        } else {
          const cond = this.parseExpr()
          this.expect('ARROW')
          branches.push({ cond, block: this.parseBlock() })
        }
        this.skipNewlines()
      }
      this.expect('RBRACE')
      return { k: 'WhenExpr', subject, branches, elseBlock, pos }
    }

    if (t.kind === 'LBRACE') {
      const lambda = this.parseLambda()
      return { k: 'LambdaExpr', lambda, pos }
    }

    if (t.kind === 'LPAREN') {
      this.next()
      const inner = this.parseExpr()
      this.expect('RPAREN')
      return inner
    }

    throw new ParseError(`Không phân tích được biểu thức bắt đầu bằng '${t.text || t.kind}'`, pos)
  }

  /**
   * Parse lại từng phần biểu thức của string template.
   *
   * Vị trí lỗi phải được QUY VỀ vị trí thật trong file. Parser lồng chỉ thấy
   * một mẩu mã rời nên mọi ParseError của nó đều báo dòng 1 cột 1; nếu ném
   * thẳng ra thì người dùng nhận vị trí vô nghĩa. StringPart mang sẵn line/col
   * của ký tự đầu mẩu — dùng nó để cộng bù.
   */
  private stringParts(parts: StringPart[]): StringPartNode[] {
    return parts.map(p => {
      if (p.type === 'text') return { type: 'text' as const, value: p.value }

      if (p.source.trim() === '') {
        throw new ParseError('Biểu thức trong ${...} đang rỗng', { line: p.line, col: p.col })
      }

      try {
        return { type: 'expr' as const, expr: new Parser(tokenize(p.source)).parseExpr() }
      } catch (err) {
        if (!(err instanceof ParseError)) throw err
        throw new ParseError(err.message, {
          line: p.line + err.pos.line - 1,
          // Chỉ cộng bù cột khi lỗi nằm ở dòng đầu của mẩu; từ dòng 2 trở đi
          // cột trong mẩu đã là cột thật.
          col: err.pos.line === 1 ? p.col + err.pos.col - 1 : err.pos.col,
        })
      }
    })
  }

  parseFunDecl(): FunDecl {
    const start = this.peek()
    const isSuspend = this.accept('KEYWORD', 'suspend')
    this.expect('KEYWORD', 'fun')
    const name = this.expect('IDENT').text
    this.expect('LPAREN')
    const params: Param[] = []
    while (!this.at('RPAREN')) {
      const pName = this.expect('IDENT').text
      let type: string | null = null
      if (this.accept('COLON')) {
        type = this.expect('IDENT').text
        while (this.accept('OP', '<')) { this.expect('IDENT'); this.expect('OP', '>') }
      }
      const defaultValue = this.accept('OP', '=') ? this.parseExpr() : null
      params.push({ name: pName, type, defaultValue })
      if (!this.accept('COMMA')) break
    }
    this.expect('RPAREN')
    if (this.accept('COLON')) this.expect('IDENT') // kiểu trả về: bỏ qua

    if (this.accept('OP', '=')) {
      return { name, params, isSuspend, body: null, exprBody: this.parseExpr(), pos: this.posOf(start) }
    }
    return { name, params, isSuspend, body: this.parseBlock(), exprBody: null, pos: this.posOf(start) }
  }

  parseProgramBody(): Program {
    const funs: FunDecl[] = []
    const topLevel: Stmt[] = []
    this.skipNewlines()
    while (!this.atEof()) {
      if (this.at('KEYWORD', 'import')) {
        while (this.peekRaw().kind !== 'NEWLINE' && !this.atEof()) this.i++
        this.skipNewlines()
        continue
      }
      if (this.at('KEYWORD', 'fun') || (this.at('KEYWORD', 'suspend') && this.peek(1).text === 'fun')) {
        funs.push(this.parseFunDecl())
      } else {
        topLevel.push(this.parseStmt())
      }
      this.skipNewlines()
      this.accept('SEMI')
      this.skipNewlines()
    }
    return { funs, topLevel }
  }

  parseBlock(): Block {
    const lb = this.expect('LBRACE')
    const stmts: Stmt[] = []
    this.skipNewlines()
    while (!this.at('RBRACE') && !this.atEof()) {
      stmts.push(this.parseStmt())
      this.skipNewlines()
      this.accept('SEMI')
      this.skipNewlines()
    }
    this.expect('RBRACE')
    return { stmts, pos: this.posOf(lb) }
  }

  parseStmt(): Stmt {
    const t = this.peek()
    const pos = this.posOf(t)

    if (t.kind === 'KEYWORD' && (t.text === 'val' || t.text === 'var')) {
      this.next()
      const name = this.expect('IDENT').text
      if (this.accept('COLON')) this.expect('IDENT') // kiểu khai báo: bỏ qua
      this.expect('OP', '=')
      return { k: 'ValDecl', name, mutable: t.text === 'var', init: this.parseExpr(), pos }
    }

    if (t.kind === 'KEYWORD' && t.text === 'while') {
      this.next()
      this.expect('LPAREN')
      const cond = this.parseExpr()
      this.expect('RPAREN')
      return { k: 'While', cond, body: this.parseBlock(), pos }
    }

    if (t.kind === 'KEYWORD' && t.text === 'for') {
      this.next()
      this.expect('LPAREN')
      const name = this.expect('IDENT').text
      this.expect('KEYWORD', 'in')
      const iterable = this.parseExpr()
      this.expect('RPAREN')
      return { k: 'For', name, iterable, body: this.parseBlock(), pos }
    }

    if (t.kind === 'KEYWORD' && t.text === 'try') {
      this.next()
      const body = this.parseBlock()
      const catches: CatchClause[] = []
      while (this.at('KEYWORD', 'catch')) {
        this.next()
        this.expect('LPAREN')
        const name = this.expect('IDENT').text
        this.expect('COLON')
        const type = this.expect('IDENT').text
        this.expect('RPAREN')
        catches.push({ name, type, block: this.parseBlock() })
      }
      const finallyBlock = this.accept('KEYWORD', 'finally') ? this.parseBlock() : null
      return { k: 'Try', body, catches, finallyBlock, pos }
    }

    if (t.kind === 'KEYWORD' && t.text === 'throw') {
      this.next()
      return { k: 'Throw', expr: this.parseExpr(), pos }
    }

    if (t.kind === 'KEYWORD' && t.text === 'return') {
      this.next()
      const endsStmt = this.peekRaw().kind === 'NEWLINE'
        || this.at('RBRACE') || this.at('SEMI') || this.atEof()
      return { k: 'Return', expr: endsStmt ? null : this.parseExpr(), pos }
    }

    const expr = this.parseExpr()
    if (this.at('OP', '=')) {
      this.next()
      return { k: 'Assign', target: expr, value: this.parseExpr(), pos }
    }
    return { k: 'ExprStmt', expr, pos }
  }

  private parseLambda(): Lambda {
    const lb = this.peek()
    this.expect('LBRACE')
    this.skipNewlines()

    // Dò tham số: IDENT (, IDENT)* ->
    const params: string[] = []
    if (this.peek().kind === 'IDENT') {
      const probe = this.i
      const collected: string[] = []
      for (;;) {
        if (this.peek().kind !== 'IDENT') break
        collected.push(this.next().text)
        if (this.accept('COMMA')) continue
        break
      }
      if (this.at('ARROW')) { this.next(); params.push(...collected) }
      else { this.i = probe }
    }
    const stmts: Stmt[] = []
    this.skipNewlines()
    while (!this.at('RBRACE') && !this.atEof()) {
      stmts.push(this.parseStmt())
      this.skipNewlines()
      this.accept('SEMI')
      this.skipNewlines()
    }
    this.expect('RBRACE')
    return { params, body: { stmts, pos: this.posOf(lb) }, pos: this.posOf(lb) }
  }
}

export function parseExprSource(src: string): Expr {
  return new Parser(tokenize(src)).parseExpr()
}

export function parseBlockSource(src: string): Block {
  return new Parser(tokenize(src)).parseBlock()
}

export function parseProgram(src: string): Program {
  return new Parser(tokenize(src)).parseProgramBody()
}
