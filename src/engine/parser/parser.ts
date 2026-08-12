import { tokenize } from '../lexer/lexer'
import type { StringPart, Token } from '../lexer/token'
// Only import the types actually used at this task. Task 4 adds Lambda, Task 5
// adds CatchClause/WhenBranch, Task 6 adds FunDecl/Param — add as needed.
import type { Arg, Block, CatchClause, Expr, FunDecl, Lambda, Param, Pos, Program, Stmt, StringPartNode, WhenBranch } from '../ast/nodes'

/**
 * Higher precedence binds tighter. Order follows Kotlin exactly.
 *
 * Note on '..': in Kotlin it is LOOSER than plus/minus and TIGHTER than
 * comparison. If '..' bound tighter than arithmetic, `1..n-1` — the most
 * common range idiom — would parse as `(1..n)-1` instead of `1..(n-1)`.
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

/**
 * Maps ONE position inside a `${...}` fragment back to the real coordinates of the file.
 *
 * Same rule as the ParseError rebase in stringParts: only add the column offset
 * when the position is on the FIRST line of the fragment, since from line 2
 * onward the column inside the fragment is already the real column. Mutates IN
 * PLACE — a Pos built by the parser is a node's private object, not shared with
 * anything outside this sub-AST.
 */
function rebasePos(pos: Pos, base: Pos, seen: Set<Pos>): void {
  // parsePostfix REUSES the very same `lambda.pos` object as the pos of the
  // enclosing Call (`{ k: 'Call', ..., pos: lambda.pos }`), so two nodes can
  // point at the same Pos. Without this guard it would get shifted twice and
  // the column would run off by double.
  if (seen.has(pos)) return
  seen.add(pos)
  if (pos.line === 1) pos.col = base.col + pos.col - 1
  pos.line = base.line + pos.line - 1
}

/**
 * Shifts an entire sub-AST built inside a `${...}` to the real coordinates of the file.
 *
 * Task 3 already rebased the position of ParseError, but the NODES built
 * SUCCESSFULLY were not: the nested parser only ever sees one loose fragment of
 * code, so every one of its nodes sits on line 1. The validator reads `pos`
 * directly, so every diagnostic inside a template would report line 1 while the
 * non-template form right next to it reports correctly.
 *
 * Nested templates get this right automatically by composition: the inner
 * nested parser has already shifted its nodes to the coordinates of the OUTER
 * fragment, and this rebase pass then brings the whole cluster to file
 * coordinates — each node correctly offset exactly once per nesting level.
 */
function rebaseExpr(e: Expr, base: Pos, seen: Set<Pos>): void {
  rebasePos(e.pos, base, seen)
  switch (e.k) {
    case 'StringLit':
      e.parts.forEach(p => { if (p.type === 'expr') rebaseExpr(p.expr, base, seen) })
      break
    case 'Unary': rebaseExpr(e.operand, base, seen); break
    case 'Binary': rebaseExpr(e.left, base, seen); rebaseExpr(e.right, base, seen); break
    case 'Range': rebaseExpr(e.from, base, seen); rebaseExpr(e.to, base, seen); break
    case 'Member': rebaseExpr(e.target, base, seen); break
    case 'Call':
      rebaseExpr(e.callee, base, seen)
      e.args.forEach(a => rebaseExpr(a.value, base, seen))
      if (e.lambda) rebaseLambda(e.lambda, base, seen)
      break
    case 'LambdaExpr': rebaseLambda(e.lambda, base, seen); break
    case 'IfExpr':
      rebaseExpr(e.cond, base, seen)
      rebaseBlock(e.thenBlock, base, seen)
      if (e.elseBlock) rebaseBlock(e.elseBlock, base, seen)
      break
    case 'WhenExpr':
      if (e.subject) rebaseExpr(e.subject, base, seen)
      e.branches.forEach(b => {
        if (b.cond) rebaseExpr(b.cond, base, seen)
        if (b.block) rebaseBlock(b.block, base, seen)
        if (b.expr) rebaseExpr(b.expr, base, seen)
      })
      break
    default: break
  }
}

function rebaseLambda(l: Lambda, base: Pos, seen: Set<Pos>): void {
  rebasePos(l.pos, base, seen)
  rebaseBlock(l.body, base, seen)
}

function rebaseBlock(b: Block, base: Pos, seen: Set<Pos>): void {
  rebasePos(b.pos, base, seen)
  b.stmts.forEach(s => rebaseStmt(s, base, seen))
}

function rebaseStmt(s: Stmt, base: Pos, seen: Set<Pos>): void {
  rebasePos(s.pos, base, seen)
  switch (s.k) {
    case 'ValDecl': rebaseExpr(s.init, base, seen); break
    case 'Assign': rebaseExpr(s.target, base, seen); rebaseExpr(s.value, base, seen); break
    case 'ExprStmt': rebaseExpr(s.expr, base, seen); break
    case 'While': rebaseExpr(s.cond, base, seen); rebaseBlock(s.body, base, seen); break
    case 'For': rebaseExpr(s.iterable, base, seen); rebaseBlock(s.body, base, seen); break
    case 'Throw': rebaseExpr(s.expr, base, seen); break
    case 'Return': if (s.expr) rebaseExpr(s.expr, base, seen); break
    case 'Try':
      rebaseBlock(s.body, base, seen)
      s.catches.forEach(c => rebaseBlock(c.block, base, seen))
      if (s.finallyBlock) rebaseBlock(s.finallyBlock, base, seen)
      break
  }
}

export class Parser {
  private i = 0
  constructor(private readonly toks: Token[]) {}

  // ---- helpers ----
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

  /** Next token, WITHOUT skipping newlines. Used where a newline is significant. */
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
        `Expected ${text ?? kind} but found '${t.text || t.kind}'`,
        { line: t.line, col: t.col },
      )
    }
    return this.next()
  }

  private posOf(t: Token): Pos { return { line: t.line, col: t.col } }

  skipNewlines(): void { while (this.toks[this.i]?.kind === 'NEWLINE') this.i++ }
  atEof(): boolean { return this.peek().kind === 'EOF' }

  /**
   * Is the next token of type `kind` AND on the same line as the current
   * position? Used for trailing lambdas: `foo()` followed by a `{ ... }` on a
   * new line is a standalone block, not foo's lambda. Without the same-line
   * condition, `val x = f()` followed by a block would get swallowed by mistake.
   */
  private atSameLine(kind: Token['kind']): boolean {
    const next = this.toks[this.i]
    if (!next || next.kind === 'NEWLINE') return false
    return next.kind === kind
  }

  // ---- expressions ----
  parseExpr(): Expr { return this.parseBinary(0) }

  /** Precedence climbing. `prec + 1` for the right operand ⇒ left-associative. */
  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'OP') break
      const prec = BINARY_PRECEDENCE[t.text]
      if (prec === undefined || prec < minPrec) break
      this.next()
      const right = this.parseBinary(prec + 1)
      // '..' shares the precedence table with the binary operators but builds a
      // separate Range node — this keeps Kotlin-correct precedence while
      // keeping the AST distinct.
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
        // Already consumed <...>; the next loop iteration will see '(' and call parseCallTail.
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
   * Distinguishes `Channel<Int>()` (type argument) from `a < b` (comparison).
   *
   * Only treated as a type argument when scanning reaches a matching '>' AND it
   * is immediately followed by '('. That second condition is what keeps `a < b`
   * from ever being misread. On failure, the cursor is restored to where it
   * was, leaving no trace.
   */
  private trySkipTypeArgs(): boolean {
    if (!this.at('OP', '<')) return false

    // A '>' followed by '(' alone is NOT enough: `x < y > (z)` also matches
    // that pattern and would get silently swallowed into Call(x, [z]) — worse
    // than a parse error. Add one more anchor: the Kotlin convention that type
    // names start with an uppercase letter. Known limitation: `x < Y > (z)`
    // where Y is an uppercase-starting variable still gets it wrong. Accepted
    // for M1 — the real compiler resolves this using type information this
    // engine doesn't have, and the M1 subset doesn't let users define generics.
    const first = this.peek(1)
    if (first.kind !== 'IDENT' || !/^[A-Z]/.test(first.text)) return false

    const save = this.i
    this.next()
    let depth = 1
    while (depth > 0) {
      if (this.atEof()) { this.i = save; return false }
      if (this.at('OP', '<')) { depth++; this.next(); continue }
      if (this.at('OP', '>')) { depth--; this.next(); continue }
      // Inside a type argument, only accept names, commas, dots, question marks.
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

  /** Task 4 will extend this to consume a trailing lambda. */
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
      while (!this.at('RBRACE') && !this.atEof()) {
        const cond = this.accept('KEYWORD', 'else') ? null : this.parseExpr()
        this.expect('ARROW')
        // The right-hand side accepts both forms: `{ ... }` (block) or a single
        // expression (`1 -> println("one")` — the most common form in real
        // Kotlin). Previously requiring LBRACE made the expression form a parse error.
        if (this.at('LBRACE')) branches.push({ cond, block: this.parseBlock(), expr: null })
        else branches.push({ cond, block: null, expr: this.parseExpr() })
        this.skipNewlines()
      }
      this.expect('RBRACE')
      return { k: 'WhenExpr', subject, branches, pos }
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

    throw new ParseError(`Could not parse an expression starting with '${t.text || t.kind}'`, pos)
  }

  /**
   * Re-parses each expression part of a string template.
   *
   * The error position must be REBASED to the real position in the file. The
   * nested parser only ever sees one loose fragment of code, so every one of
   * its ParseErrors reports line 1 column 1; throwing it straight through would
   * hand the user a meaningless position. StringPart already carries the
   * line/col of the fragment's first character — use it to apply the offset.
   */
  private stringParts(parts: StringPart[]): StringPartNode[] {
    return parts.map(p => {
      if (p.type === 'text') return { type: 'text' as const, value: p.value }

      if (p.source.trim() === '') {
        throw new ParseError('Expression inside ${...} is empty', { line: p.line, col: p.col })
      }

      try {
        const expr = new Parser(tokenize(p.source)).parseExpr()
        // The node also needs rebasing, exactly like the ParseError rebase
        // below — just silently: parsing succeeded, so nothing looks wrong
        // until the validator reports an error on line 1.
        rebaseExpr(expr, { line: p.line, col: p.col }, new Set())
        return { type: 'expr' as const, expr }
      } catch (err) {
        if (!(err instanceof ParseError)) throw err
        throw new ParseError(err.message, {
          line: p.line + err.pos.line - 1,
          // Only add the column offset when the error is on the fragment's
          // first line; from line 2 onward the column inside the fragment is
          // already the real column.
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
    if (this.accept('COLON')) this.expect('IDENT') // return type: ignored

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
      if (this.accept('COLON')) this.expect('IDENT') // declared type: ignored
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

    // Probe for parameters: IDENT (, IDENT)* ->
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
