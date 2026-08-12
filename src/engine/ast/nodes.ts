export interface Pos { line: number; col: number }

export type StringPartNode =
  | { type: 'text'; value: string }
  | { type: 'expr'; expr: Expr }

export interface Arg { name: string | null; value: Expr }
export interface Lambda { params: string[]; body: Block; pos: Pos }
export interface Block { stmts: Stmt[]; pos: Pos }
export interface WhenBranch {
  /** null = the `else` branch. */
  cond: Expr | null
  /** Right-hand side in `{ ... }` form. Exactly one of block/expr is non-null. */
  block: Block | null
  /** Right-hand side as a single expression: `1 -> println("one")`. */
  expr: Expr | null
}
export interface CatchClause { name: string; type: string; block: Block }
export interface Param { name: string; type: string | null; defaultValue: Expr | null }

export type Expr =
  | { k: 'NumberLit'; value: number; pos: Pos }
  | { k: 'StringLit'; parts: StringPartNode[]; pos: Pos }
  | { k: 'BoolLit'; value: boolean; pos: Pos }
  | { k: 'NullLit'; pos: Pos }
  | { k: 'Ident'; name: string; pos: Pos }
  | { k: 'Unary'; op: string; operand: Expr; pos: Pos }
  | { k: 'Binary'; op: string; left: Expr; right: Expr; pos: Pos }
  | { k: 'Range'; from: Expr; to: Expr; pos: Pos }
  | { k: 'Member'; target: Expr; name: string; pos: Pos }
  | { k: 'Call'; callee: Expr; args: Arg[]; lambda: Lambda | null; pos: Pos }
  | { k: 'LambdaExpr'; lambda: Lambda; pos: Pos }
  | { k: 'IfExpr'; cond: Expr; thenBlock: Block; elseBlock: Block | null; pos: Pos }
  | { k: 'WhenExpr'; subject: Expr | null; branches: WhenBranch[]; pos: Pos }

export type Stmt =
  | { k: 'ValDecl'; name: string; mutable: boolean; init: Expr; pos: Pos }
  | { k: 'Assign'; target: Expr; value: Expr; pos: Pos }
  | { k: 'ExprStmt'; expr: Expr; pos: Pos }
  | { k: 'While'; cond: Expr; body: Block; pos: Pos }
  | { k: 'For'; name: string; iterable: Expr; body: Block; pos: Pos }
  | { k: 'Try'; body: Block; catches: CatchClause[]; finallyBlock: Block | null; pos: Pos }
  | { k: 'Throw'; expr: Expr; pos: Pos }
  | { k: 'Return'; expr: Expr | null; pos: Pos }

export interface FunDecl {
  name: string
  params: Param[]
  isSuspend: boolean
  /** Exactly one of the two is non-null. `fun main() = runBlocking { }` uses exprBody. */
  body: Block | null
  exprBody: Expr | null
  pos: Pos
}

export interface Program { funs: FunDecl[]; topLevel: Stmt[] }
