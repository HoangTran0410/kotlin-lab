# M1 — Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engine TypeScript thuần biến source Kotlin (subset core) thành `Event[]`, chạy đúng 3 lesson `jobtree` / `normalfail` / `supervisor`, kiểm chứng bằng test — chưa có UI.

**Architecture:** Lexer → Parser → Validator → Interpreter (JS generator) chạy trên VirtualScheduler → `Event[]`. Trace là nguồn sự thật duy nhất; `WorldState` tại step N là `fold(events, 0..N)`. Toàn bộ ngữ nghĩa khó (cancel xuống / failure lên / supervisor boundary) tập trung ở một module `runtime/propagation`.

**Tech Stack:** TypeScript 5 (strict), Vitest, ESLint (flat config). Không dependency runtime nào ở M1.

## Global Constraints

- Node `v20.19.0` (đã cài sẵn, qua nvm). Package manager: `npm`.
- TypeScript `strict: true`. Không dùng `any` — dùng `unknown` rồi narrow.
- **`src/engine/**` cấm import `react`, `react-dom`, `@xyflow/*`, `zustand`, và cấm chạm DOM.** Ép bằng ESLint `no-restricted-imports`. Đây là ranh giới kiến trúc, không phải sở thích.
- **Deterministic tuyệt đối**: cùng source → cùng `Event[]`, byte-for-byte. Cấm `Math.random`, `Date.now`, `Set`/`Map` iteration phụ thuộc thứ tự chèn không xác định.
- **Không bao giờ ngủ thật.** `delay(ms)` chỉ đẩy thời gian ảo. Engine không được gọi `setTimeout`.
- Engine không truy cập mạng.
- **Mọi thông báo lỗi (Diagnostic) viết bằng tiếng Việt**, kèm số dòng 1-based.
- Mọi `Event` có `seq` tăng đơn điệu từ 0 và `t` là mili giây ảo.
- Commit sau mỗi task.

## Ranh giới M1 — cố ý để lại

Spec §4.1 liệt kê toàn bộ subset của **v1**, không phải của M1. Những thứ sau thuộc core
nhưng **cố ý chưa làm ở M1**, vì nghiệm thu M1 là 3 lesson `jobtree`/`normalfail`/`supervisor`
và chúng không cần tới:

- `withTimeout` / `withTimeoutOrNull`
- `NonCancellable`
- `ensureActive()` / `isActive` đọc trong thân coroutine
- `invokeOnCompletion { }`
- `CoroutineExceptionHandler` nhận exception thật (event `HANDLER_RECEIVED` đã định nghĩa
  ở Task 8 nhưng chưa nơi nào phát — đúng như dự kiến)
- `job.children`, `job.isCancelled`, `job.isCompleted` đọc từ code Kotlin
- `Deferred.await()` trả **giá trị** (M1 chỉ chờ xong, chưa truyền kết quả)

Đây là danh sách đã biết, không phải thiếu sót. Chúng nằm ở kế hoạch M3.

---

### Task 1: Scaffold dự án + lexer lõi

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`
- Create: `src/engine/lexer/token.ts`
- Create: `src/engine/lexer/lexer.ts`
- Test: `tests/engine/lexer.test.ts`

**Interfaces:**
- Consumes: nothing (task đầu tiên)
- Produces: `Token`, `TokenKind`, `StringPart`, `tokenize(src: string): Token[]`

- [ ] **Step 1: Tạo scaffold**

`package.json`:
```json
{
  "name": "kotlin-coroutines-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "eslint": "^9.12.0",
    "typescript-eslint": "^8.8.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
})
```

`eslint.config.js` — ranh giới kiến trúc nằm ở đây:
```js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    // Quy ước tiền tố '_' cho tham số/biến cố ý không dùng. Cần thiết vì các
    // task sau có stub và tham số giữ chỗ cho hợp đồng kiểu; nếu không có nó
    // thì mỗi task lại phải tự chế một hack kiểu `void x` để né lint.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'engine phải thuần TypeScript, không phụ thuộc UI' },
          { name: 'react-dom', message: 'engine phải thuần TypeScript, không phụ thuộc UI' },
          { name: 'zustand', message: 'engine phải thuần TypeScript, không phụ thuộc UI' },
        ],
        patterns: ['@xyflow/*'],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'engine không được chạm DOM' },
        { name: 'document', message: 'engine không được chạm DOM' },
        { name: 'setTimeout', message: 'engine dùng thời gian ảo, không ngủ thật' },
      ],
    },
  },
)
```

`.gitignore`:
```
node_modules
dist
.DS_Store
```

Run: `npm install`

- [ ] **Step 2: Viết test lexer thất bại**

`tests/engine/lexer.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — lõi', () => {
  it('tách định danh, từ khoá và số', () => {
    const toks = tokenize('val x = 42')
    expect(toks.map(t => [t.kind, t.text])).toEqual([
      ['KEYWORD', 'val'], ['IDENT', 'x'], ['OP', '='], ['NUMBER', '42'], ['EOF', ''],
    ])
  })

  it('ghi đúng dòng và cột 1-based', () => {
    const toks = tokenize('val a\nval b')
    const b = toks.find(t => t.text === 'b')!
    expect({ line: b.line, col: b.col }).toEqual({ line: 2, col: 5 })
  })

  it('nhận diện dấu ngoặc và dấu chấm', () => {
    const toks = tokenize('launch(a.b)')
    expect(toks.map(t => t.kind)).toEqual(
      ['IDENT', 'LPAREN', 'IDENT', 'DOT', 'IDENT', 'RPAREN', 'EOF'])
  })

  it('toán tử nhiều ký tự không bị tách rời', () => {
    const toks = tokenize('a >= b && c != d')
    expect(toks.filter(t => t.kind === 'OP').map(t => t.text)).toEqual(['>=', '&&', '!='])
  })

  it('1..3 tách thành NUMBER, OP(..), NUMBER — không gộp thành một số', () => {
    const toks = tokenize('1..3')
    expect(toks.map(t => [t.kind, t.text])).toEqual([
      ['NUMBER', '1'], ['OP', '..'], ['NUMBER', '3'], ['EOF', ''],
    ])
  })

  it('for (i in 1..10) tokenize đúng — construct khoảng phổ biến nhất', () => {
    const toks = tokenize('for (i in 1..10)')
    expect(toks.filter(t => t.kind === 'NUMBER' || t.kind === 'OP').map(t => t.text))
      .toEqual(['1', '..', '10'])
  })

  it('số thập phân vẫn giữ nguyên dấu chấm', () => {
    expect(tokenize('1.5')[0]).toMatchObject({ kind: 'NUMBER', text: '1.5' })
  })

  it('a.b vẫn là truy cập thành viên, không phải khoảng', () => {
    expect(tokenize('a.b').map(t => t.kind)).toEqual(['IDENT', 'DOT', 'IDENT', 'EOF'])
  })

  it('dấu gạch dưới trong số được loại bỏ', () => {
    expect(tokenize('1_000_000')[0]!.text).toBe('1000000')
  })

  it('ký tự lạ ném lỗi tiếng Việt kèm dòng và cột 1-based', () => {
    expect(() => tokenize('val a\nval #')).toThrow(/không nhận diện được.*dòng 2.*cột 5/)
  })
})
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/lexer.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/engine/lexer/lexer"`

- [ ] **Step 4: Viết `token.ts`**

```ts
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
  'try', 'catch', 'finally', 'throw', 'return', 'when', 'true', 'false', 'null',
])

/** Toán tử nhiều ký tự phải đứng trước toán tử ngắn hơn để khớp tham lam. */
export const OPERATORS = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '..', '?:', '?.',
  '+=', '-=', '*=', '/=', '=', '<', '>', '+', '-', '*', '/', '%', '!', '?',
]
```

- [ ] **Step 5: Viết `lexer.ts` (chưa xử lý chuỗi/chú thích — Task 2)**

```ts
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
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/lexer.test.ts`
Expected: PASS — 10 test.

Chú ý: test đầu mong đợi **không có NEWLINE** giữa các token vì input một dòng; nếu fail vì có `NEWLINE` thừa, sửa test cho khớp thực tế chứ đừng bỏ NEWLINE khỏi lexer — parser cần nó.

- [ ] **Step 7: Chạy typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: cả hai sạch.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(engine): scaffold dự án + lexer lõi"
```

---

### Task 2: Lexer — chuỗi, string template, chú thích

**Files:**
- Modify: `src/engine/lexer/lexer.ts`
- Test: `tests/engine/lexer-string.test.ts`

**Interfaces:**
- Consumes: `Token`, `StringPart`, `tokenize` (Task 1)
- Produces: token `STRING` có `parts: StringPart[]`. Part `expr` mang `source` là mã Kotlin thô, **parser sẽ tự lex+parse lại** — lexer không đệ quy.

- [ ] **Step 1: Viết test thất bại**

`tests/engine/lexer-string.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { tokenize } from '../../src/engine/lexer/lexer'

describe('lexer — chuỗi và chú thích', () => {
  it('chuỗi thường thành một part text', () => {
    const t = tokenize('"hello"')[0]!
    expect(t.kind).toBe('STRING')
    expect(t.parts).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('template $ident tách thành part expr', () => {
    // "a $x b" -> cột 1='"' 2='a' 3=' ' 4='$' 5='x'. Part expr phải trỏ vào
    // vị trí BẮT ĐẦU của biểu thức (cột 5), giống hệt cách ${...} làm.
    const t = tokenize('"a $x b"')[0]!
    expect(t.parts).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'expr', source: 'x', line: 1, col: 5 },
      { type: 'text', value: ' b' },
    ])
  })

  it('$ident nhiều ký tự vẫn trỏ vào ký tự đầu tiên', () => {
    const t = tokenize('"$name"')[0]!
    expect(t.parts).toEqual([{ type: 'expr', source: 'name', line: 1, col: 3 }])
  })

  it('template ${expr} giữ nguyên biểu thức bên trong', () => {
    const t = tokenize('"n=${a.b(1)}"')[0]!
    expect(t.parts?.[1]).toEqual({ type: 'expr', source: 'a.b(1)', line: 1, col: 6 })
  })

  it('escape sequence được giải mã', () => {
    const t = tokenize('"a\\nb\\$c"')[0]!
    expect(t.parts).toEqual([{ type: 'text', value: 'a\nb$c' }])
  })

  it('bỏ qua chú thích dòng và chú thích khối', () => {
    const toks = tokenize('val a // ghi chú\n/* nhiều\ndòng */ val b')
    expect(toks.filter(t => t.kind === 'IDENT').map(t => t.text)).toEqual(['a', 'b'])
  })

  it('nội dung trong chú thích không sinh token nào', () => {
    // Test này thực sự kiểm tra việc bỏ qua chú thích: nếu comment không được
    // xử lý thì 'val' và 'b' bên trong sẽ lọt ra thành token.
    const toks = tokenize('/* val b = 1 */ val a')
    expect(toks.filter(t => t.kind === 'IDENT' || t.kind === 'KEYWORD').map(t => t.text))
      .toEqual(['val', 'a'])
  })

  it('chú thích khối nhiều dòng vẫn đếm đúng số dòng', () => {
    const toks = tokenize('/* a\nb */\nval x')
    expect(toks.find(t => t.text === 'x')!.line).toBe(3)
  })

  it('lambda lồng trong ${} không làm part kết thúc sớm', () => {
    const t = tokenize('"${list.map { it }}"')[0]!
    expect(t.parts).toEqual([{ type: 'expr', source: 'list.map { it }', line: 1, col: 4 }])
  })

  it('$ đứng một mình là ký tự thường, không phải template', () => {
    expect(tokenize('"giá 5$ thôi"')[0]!.parts).toEqual([{ type: 'text', value: 'giá 5$ thôi' }])
  })

  it('$ theo sau bởi chữ số không phải template', () => {
    expect(tokenize('"$5"')[0]!.parts).toEqual([{ type: 'text', value: '$5' }])
  })

  it('chuỗi chưa đóng ném lỗi tiếng Việt kèm vị trí mở', () => {
    expect(() => tokenize('val s = "abc')).toThrow(/chuỗi chưa được đóng.*dòng 1.*cột 9/)
  })

  it('chú thích khối chưa đóng ném lỗi tiếng Việt', () => {
    expect(() => tokenize('val a\n/* chưa đóng')).toThrow(/chú thích khối chưa được đóng.*dòng 2/)
  })

  it('${ chưa đóng ném lỗi tiếng Việt', () => {
    expect(() => tokenize('"n=${a"')).toThrow(/thiếu .* đóng/)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/lexer-string.test.ts`
Expected: FAIL — lexer ném "ký tự không nhận diện được '\"'".

- [ ] **Step 3: Thêm xử lý chú thích vào vòng lặp `tokenize`**

Chèn ngay sau nhánh bỏ qua khoảng trắng, **trước** nhánh `ARROW`:
```ts
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
```

- [ ] **Step 4: Thêm xử lý chuỗi**

Chèn ngay trước nhánh `NUMBER`:
```ts
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
```

Thêm `StringPart` vào dòng import đầu file:
```ts
import { KEYWORDS, OPERATORS, type StringPart, type Token, type TokenKind } from './token'
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/lexer-string.test.ts`
Expected: PASS — 14 test.

- [ ] **Step 6: Chạy toàn bộ test + lint**

Run: `npm test && npm run lint`
Expected: sạch, Task 1 không vỡ.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): lexer xử lý chuỗi, string template, chú thích"
```

---

### Task 3: AST + parser biểu thức

**Files:**
- Create: `src/engine/ast/nodes.ts`
- Create: `src/engine/parser/parser.ts`
- Test: `tests/engine/parser-expr.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `Token` (Task 1–2)
- Produces: toàn bộ kiểu AST ở `ast/nodes.ts`; class `Parser` với `parseExpr(): Expr`; hàm `parseProgram(src: string): Program` (Task 6 mới hoàn chỉnh).

- [ ] **Step 1: Viết `src/engine/ast/nodes.ts`**

Đây là hợp đồng kiểu cho mọi task sau. Viết đủ ngay từ đầu, kể cả node chưa dùng tới.

```ts
export interface Pos { line: number; col: number }

export type StringPartNode =
  | { type: 'text'; value: string }
  | { type: 'expr'; expr: Expr }

export interface Arg { name: string | null; value: Expr }
export interface Lambda { params: string[]; body: Block; pos: Pos }
export interface Block { stmts: Stmt[]; pos: Pos }
export interface WhenBranch { cond: Expr; block: Block }
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
  | { k: 'WhenExpr'; subject: Expr | null; branches: WhenBranch[]; elseBlock: Block | null; pos: Pos }

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
  /** Đúng một trong hai khác null. `fun main() = runBlocking { }` dùng exprBody. */
  body: Block | null
  exprBody: Expr | null
  pos: Pos
}

export interface Program { funs: FunDecl[]; topLevel: Stmt[] }
```

- [ ] **Step 2: Viết test thất bại**

`tests/engine/parser-expr.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseExprSource } from '../../src/engine/parser/parser'

describe('parser — biểu thức', () => {
  it('literal số', () => {
    expect(parseExprSource('42')).toMatchObject({ k: 'NumberLit', value: 42 })
  })

  it('toán tử nhị phân theo đúng độ ưu tiên', () => {
    // 1 + 2 * 3  ->  Binary(+, 1, Binary(*, 2, 3))
    expect(parseExprSource('1 + 2 * 3')).toMatchObject({
      k: 'Binary', op: '+',
      left: { k: 'NumberLit', value: 1 },
      right: { k: 'Binary', op: '*' },
    })
  })

  it('so sánh có độ ưu tiên thấp hơn cộng trừ', () => {
    expect(parseExprSource('a + 1 > b')).toMatchObject({ k: 'Binary', op: '>' })
  })

  it('truy cập thành viên nối chuỗi', () => {
    expect(parseExprSource('a.b.c')).toMatchObject({
      k: 'Member', name: 'c', target: { k: 'Member', name: 'b' },
    })
  })

  it('lời gọi hàm có đối số', () => {
    expect(parseExprSource('delay(1000)')).toMatchObject({
      k: 'Call',
      callee: { k: 'Ident', name: 'delay' },
      args: [{ name: null, value: { k: 'NumberLit', value: 1000 } }],
    })
  })

  it('đối số có tên', () => {
    expect(parseExprSource('f(x = 1)')).toMatchObject({
      k: 'Call', args: [{ name: 'x', value: { k: 'NumberLit', value: 1 } }],
    })
  })

  it('string template thành StringLit có part expr', () => {
    expect(parseExprSource('"n=$x"')).toMatchObject({
      k: 'StringLit',
      parts: [{ type: 'text', value: 'n=' }, { type: 'expr', expr: { k: 'Ident', name: 'x' } }],
    })
  })

  it('khoảng 1..3', () => {
    expect(parseExprSource('1..3')).toMatchObject({ k: 'Range' })
  })

  it("'..' lỏng hơn cộng trừ — 1..n-1 là 1..(n-1), KHÔNG phải (1..n)-1", () => {
    expect(parseExprSource('1..n-1')).toMatchObject({
      k: 'Range',
      from: { k: 'NumberLit', value: 1 },
      to: { k: 'Binary', op: '-', left: { k: 'Ident', name: 'n' } },
    })
  })

  it("'..' chặt hơn so sánh — a < 1..n là a < (1..n)", () => {
    expect(parseExprSource('a < 1..n')).toMatchObject({
      k: 'Binary', op: '<', right: { k: 'Range' },
    })
  })

  it('cùng độ ưu tiên thì kết hợp trái — 1-2-3 là (1-2)-3', () => {
    expect(parseExprSource('1 - 2 - 3')).toMatchObject({
      k: 'Binary', op: '-',
      left: { k: 'Binary', op: '-', left: { k: 'NumberLit', value: 1 } },
      right: { k: 'NumberLit', value: 3 },
    })
  })

  it('lỗi trong ${...} báo vị trí THẬT trong file, không phải vị trí trong mẩu', () => {
    // '"n=${a +}"' — dấu ')' thiếu toán hạng. '${' ở cột 4, nên 'a' ở cột 6.
    expect(() => parseExprSource('"n=${a +}"')).toThrow()
    try {
      parseExprSource('"n=${a +}"')
    } catch (e) {
      expect((e as { pos: { col: number } }).pos.col).toBeGreaterThanOrEqual(6)
    }
  })

  it('${} rỗng báo lỗi rõ ràng thay vì chết vì EOF', () => {
    expect(() => parseExprSource('"n=${}"')).toThrow(/rỗng/)
  })

  it('ngoặc đơn đổi độ ưu tiên', () => {
    expect(parseExprSource('(1 + 2) * 3')).toMatchObject({
      k: 'Binary', op: '*', left: { k: 'Binary', op: '+' },
    })
  })
})
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/parser-expr.test.ts`
Expected: FAIL — không resolve được `parser`.

- [ ] **Step 4: Viết `src/engine/parser/parser.ts`**

```ts
import { tokenize } from '../lexer/lexer'
import type { StringPart, Token } from '../lexer/token'
// Chỉ import kiểu thực sự dùng ở task này. Task 4 thêm Lambda, Task 5 thêm
// Stmt/CatchClause/WhenBranch, Task 6 thêm FunDecl/Param — thêm khi cần.
import type { Arg, Block, Expr, Pos, Program, StringPartNode } from '../ast/nodes'

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
      } else if (this.at('LPAREN')) {
        expr = this.parseCallTail(expr)
      } else {
        break
      }
    }
    return expr
  }

  /**
   * Chỉ đọc phần `(args)`. Trailing lambda KHÔNG xử lý ở đây mà ở parsePostfix,
   * vì `launch { }` không có ngoặc đơn nào để hàm này bám vào.
   */
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

  // Task 5 cài parseBlock/parseStmt; Task 6 cài parseProgram.
  parseBlock(): Block { throw new ParseError('parseBlock chưa cài — Task 5', { line: 0, col: 0 }) }
}

export function parseExprSource(src: string): Expr {
  return new Parser(tokenize(src)).parseExpr()
}

export function parseProgram(_src: string): Program {
  throw new ParseError('parseProgram chưa cài — Task 6', { line: 0, col: 0 })
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/parser-expr.test.ts`
Expected: PASS — 14 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): AST + parser biểu thức"
```

---

### Task 4: Parser — lambda và trailing lambda

**Files:**
- Modify: `src/engine/parser/parser.ts`
- Test: `tests/engine/parser-lambda.test.ts`

**Interfaces:**
- Consumes: `Parser`, `Expr`, `Lambda`, `Block` (Task 3)
- Produces: `Call.lambda` được điền; `Expr` kiểu `LambdaExpr`. Đây là task quyết định vì `launch { }` chính là call có trailing lambda và không có ngoặc đơn.

- [ ] **Step 1: Viết test thất bại**

`tests/engine/parser-lambda.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseExprSource } from '../../src/engine/parser/parser'

describe('parser — lambda', () => {
  it('trailing lambda không có ngoặc đơn: launch { }', () => {
    expect(parseExprSource('launch { }')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'launch' }, args: [],
      lambda: { params: [] },
    })
  })

  it('trailing lambda sau đối số: launch(Dispatchers.IO) { }', () => {
    expect(parseExprSource('launch(Dispatchers.IO) { }')).toMatchObject({
      k: 'Call',
      args: [{ value: { k: 'Member', name: 'IO' } }],
      lambda: { params: [] },
    })
  })

  it('lambda có tham số đặt tên: handler { ctx, e -> }', () => {
    expect(parseExprSource('handler { ctx, e -> }')).toMatchObject({
      k: 'Call', lambda: { params: ['ctx', 'e'] },
    })
  })

  it('lambda lồng nhau', () => {
    const ast = parseExprSource('launch { launch { } }')
    expect(ast).toMatchObject({
      k: 'Call',
      lambda: { body: { stmts: [{ k: 'ExprStmt', expr: { k: 'Call', callee: { k: 'Ident', name: 'launch' } } }] } },
    })
  })

  it('lambda đứng riêng làm biểu thức', () => {
    expect(parseExprSource('{ x -> x }')).toMatchObject({
      k: 'LambdaExpr', lambda: { params: ['x'] },
    })
  })

  it('gọi chuỗi rồi trailing lambda: scope.launch { }', () => {
    expect(parseExprSource('scope.launch { }')).toMatchObject({
      k: 'Call',
      callee: { k: 'Member', target: { k: 'Ident', name: 'scope' }, name: 'launch' },
      lambda: { params: [] },
    })
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/parser-lambda.test.ts`
Expected: FAIL — `parseBlock chưa cài — Task 5` hoặc lỗi parse ở `{`.

- [ ] **Step 3: Cài `parseLambda` + tạm thời cho `parseBlock` xử lý thân rỗng và ExprStmt**

Thay thân `parseBlock` trong `Parser` bằng bản dùng được (Task 5 sẽ mở rộng đủ loại câu lệnh):

```ts
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

  /** Task 5 thay thế bằng bản đầy đủ. */
  parseStmt(): Stmt {
    const t = this.peek()
    return { k: 'ExprStmt', expr: this.parseExpr(), pos: this.posOf(t) }
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
```

- [ ] **Step 4: Cho `parsePostfix` nuốt trailing lambda, và `parsePrimary` nhận lambda đứng riêng**

Trong `parsePostfix`, thêm nhánh **trước** `break`:
```ts
      } else if (this.atSameLine('LBRACE')) {
        const lambda = this.parseLambda()
        expr = expr.k === 'Call' && expr.lambda === null
          ? { ...expr, lambda }
          : { k: 'Call', callee: expr, args: [], lambda, pos: lambda.pos }
      } else {
```

Thêm tiện ích vào `Parser` — trailing lambda phải nằm **cùng dòng** với lời gọi, nếu không `{` ở dòng sau sẽ bị nuốt nhầm:
```ts
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
```

Trong `parsePrimary`, thêm **trước** nhánh `LPAREN`:
```ts
    if (t.kind === 'LBRACE') {
      const lambda = this.parseLambda()
      return { k: 'LambdaExpr', lambda, pos }
    }
```

Thêm `Stmt` vào import kiểu ở đầu file nếu chưa có.

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/parser-lambda.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 6: Chạy toàn bộ test**

Run: `npm test`
Expected: Task 1–3 vẫn xanh.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): parser lambda và trailing lambda"
```

---

### Task 5: Parser — câu lệnh

**Files:**
- Modify: `src/engine/parser/parser.ts`
- Test: `tests/engine/parser-stmt.test.ts`

**Interfaces:**
- Consumes: `Parser.parseBlock`, `parseExpr` (Task 3–4)
- Produces: `Parser.parseStmt(): Stmt` đầy đủ cho `val`/`var`, gán, `if`/`else`, `while`, `for`, `try`/`catch`/`finally`, `throw`, `return`, `when`.

- [ ] **Step 1: Viết test thất bại**

`tests/engine/parser-stmt.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseBlockSource } from '../../src/engine/parser/parser'

const first = (src: string) => parseBlockSource(`{ ${src} }`).stmts[0]

describe('parser — câu lệnh', () => {
  it('val có khởi tạo', () => {
    expect(first('val x = 1')).toMatchObject({ k: 'ValDecl', name: 'x', mutable: false })
  })

  it('var đánh dấu mutable', () => {
    expect(first('var x = 1')).toMatchObject({ k: 'ValDecl', name: 'x', mutable: true })
  })

  it('gán lại biến', () => {
    expect(first('x = 2')).toMatchObject({ k: 'Assign', target: { k: 'Ident', name: 'x' } })
  })

  it('if có else', () => {
    expect(first('if (a) { b() } else { c() }')).toMatchObject({
      k: 'ExprStmt',
      expr: { k: 'IfExpr', elseBlock: { stmts: [{ k: 'ExprStmt' }] } },
    })
  })

  it('while', () => {
    expect(first('while (a) { b() }')).toMatchObject({ k: 'While' })
  })

  it('for trên khoảng', () => {
    expect(first('for (i in 1..3) { f(i) }')).toMatchObject({
      k: 'For', name: 'i', iterable: { k: 'Range' },
    })
  })

  it('try/catch/finally', () => {
    expect(first('try { a() } catch (e: Exception) { b() } finally { c() }')).toMatchObject({
      k: 'Try',
      catches: [{ name: 'e', type: 'Exception' }],
      finallyBlock: { stmts: [{ k: 'ExprStmt' }] },
    })
  })

  it('try không có finally', () => {
    expect(first('try { a() } catch (e: Exception) { b() }')).toMatchObject({
      k: 'Try', finallyBlock: null,
    })
  })

  it('throw', () => {
    expect(first('throw RuntimeException("boom")')).toMatchObject({
      k: 'Throw', expr: { k: 'Call', callee: { k: 'Ident', name: 'RuntimeException' } },
    })
  })

  it('return không có giá trị', () => {
    expect(first('return')).toMatchObject({ k: 'Return', expr: null })
  })

  it('when có else', () => {
    expect(first('when { a -> { f() } else -> { g() } }')).toMatchObject({
      k: 'ExprStmt', expr: { k: 'WhenExpr', branches: [{}], elseBlock: {} },
    })
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/parser-stmt.test.ts`
Expected: FAIL — `parseBlockSource` chưa export; `val` không parse được.

- [ ] **Step 3: Thay `parseStmt` bằng bản đầy đủ**

```ts
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
```

- [ ] **Step 4: Thêm `if` và `when` vào `parsePrimary`**

Chèn trong `parsePrimary`, trước nhánh `LBRACE`:
```ts
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
```

Cập nhật import kiểu ở đầu file cho đủ: `Block, CatchClause, WhenBranch`.

- [ ] **Step 5: Export `parseBlockSource`**

Thêm cuối file:
```ts
export function parseBlockSource(src: string): Block {
  return new Parser(tokenize(src)).parseBlock()
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/parser-stmt.test.ts`
Expected: PASS — 11 test.

- [ ] **Step 7: Thêm test hồi quy cho ranh giới trailing-lambda**

Task 4 dựa vào `atSameLine()` để phân biệt trailing lambda với một khối rời ở
dòng sau, nhưng không có test nào phủ chiều phủ định. Vì task này sửa
`parseStmt` — thứ mà `parseBlock` và `parseLambda` đều gọi — hãy chốt bất biến
đó lại trước khi nó có thể vỡ âm thầm.

Thêm vào **cuối** `tests/engine/parser-lambda.test.ts`:

```ts
describe('parser — ranh giới trailing lambda', () => {
  it('khối ở DÒNG SAU không bị nuốt thành trailing lambda', () => {
    // `f()` kết thúc ở dòng 1. `{ g() }` ở dòng 2 là khối rời.
    const blk = parseBlockSource('{ f()\n{ g() } }')
    expect(blk.stmts).toHaveLength(2)
    expect(blk.stmts[0]).toMatchObject({ k: 'ExprStmt', expr: { k: 'Call', lambda: null } })
  })

  it('khối cùng dòng thì vẫn là trailing lambda', () => {
    const blk = parseBlockSource('{ f() { g() } }')
    expect(blk.stmts).toHaveLength(1)
    expect(blk.stmts[0]).toMatchObject({ k: 'ExprStmt', expr: { k: 'Call', lambda: {} } })
  })
})
```

Thêm `parseBlockSource` vào dòng import của file đó.

- [ ] **Step 8: Chạy toàn bộ test + typecheck**

Run: `npm test && npm run typecheck`
Expected: sạch. `parser-lambda.test.ts` giờ có 8 test.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(engine): parser câu lệnh"
```

---

### Task 6: Parser — khai báo hàm và chương trình

**Files:**
- Modify: `src/engine/parser/parser.ts`
- Test: `tests/engine/parser-program.test.ts`

**Interfaces:**
- Consumes: `Parser.parseStmt`, `parseBlock` (Task 5)
- Produces: `parseProgram(src: string): Program` hoạt động thật. Đây là cửa vào duy nhất mà validator và interpreter dùng.

- [ ] **Step 1: Viết test thất bại**

`tests/engine/parser-program.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseProgram } from '../../src/engine/parser/parser'

describe('parser — chương trình', () => {
  it('fun main() có thân khối', () => {
    const p = parseProgram('fun main() {\n  println("hi")\n}')
    expect(p.funs).toHaveLength(1)
    expect(p.funs[0]).toMatchObject({ name: 'main', isSuspend: false, exprBody: null })
    expect(p.funs[0]!.body!.stmts).toHaveLength(1)
  })

  it('fun main() = runBlocking { } dùng exprBody', () => {
    const p = parseProgram('fun main() = runBlocking {\n  delay(1)\n}')
    expect(p.funs[0]).toMatchObject({
      name: 'main', body: null,
      exprBody: { k: 'Call', callee: { k: 'Ident', name: 'runBlocking' } },
    })
  })

  it('suspend fun được đánh dấu', () => {
    const p = parseProgram('suspend fun work() {\n  delay(1)\n}')
    expect(p.funs[0]).toMatchObject({ name: 'work', isSuspend: true })
  })

  it('tham số có kiểu và giá trị mặc định', () => {
    const p = parseProgram('fun f(name: String, n: Int = 3) {\n}')
    expect(p.funs[0]!.params).toMatchObject([
      { name: 'name', type: 'String', defaultValue: null },
      { name: 'n', type: 'Int', defaultValue: { k: 'NumberLit', value: 3 } },
    ])
  })

  it('nhiều hàm và khai báo top-level', () => {
    const p = parseProgram('val g = 1\nfun a() {\n}\nfun b() {\n}')
    expect(p.funs.map(f => f.name)).toEqual(['a', 'b'])
    expect(p.topLevel).toMatchObject([{ k: 'ValDecl', name: 'g' }])
  })

  it('bỏ qua dòng import', () => {
    const p = parseProgram('import kotlinx.coroutines.*\nfun main() {\n}')
    expect(p.funs.map(f => f.name)).toEqual(['main'])
    expect(p.topLevel).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/parser-program.test.ts`
Expected: FAIL — `parseProgram chưa cài — Task 6`.

- [ ] **Step 3: Thêm `import` vào KEYWORDS trong lexer**

`src/engine/lexer/token.ts` — thêm `'import'` vào `KEYWORDS`.

- [ ] **Step 4: Cài `parseFun` và `parseProgram`**

Thêm vào class `Parser`:
```ts
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
```

Thay `parseProgram` ở cuối file:
```ts
export function parseProgram(src: string): Program {
  return new Parser(tokenize(src)).parseProgramBody()
}
```

Bổ sung import kiểu: `FunDecl, Param`.

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/parser-program.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 6: Đóng các khoảng trống che phủ mà review Task 5 nêu**

Thêm vào cuối `tests/engine/parser-stmt.test.ts`:

```ts
describe('parser — khoảng trống che phủ từ review Task 5', () => {
  it('for (i in 1..n-1): số học nằm TRONG khoảng, không nằm ngoài', () => {
    // Ghim lỗi ưu tiên '..' đã sửa ở Task 3, lần này ở tầng câu lệnh.
    expect(first('for (i in 1..n-1) { f(i) }')).toMatchObject({
      k: 'For',
      iterable: { k: 'Range', to: { k: 'Binary', op: '-' } },
    })
  })

  it('return có giá trị', () => {
    expect(first('return x + 1')).toMatchObject({ k: 'Return', expr: { k: 'Binary', op: '+' } })
  })

  it('return rồi dấu chấm phẩy vẫn là return rỗng', () => {
    expect(first('return;')).toMatchObject({ k: 'Return', expr: null })
  })

  it('when có subject', () => {
    expect(first('when (x) { 1 -> { f() } else -> { g() } }')).toMatchObject({
      k: 'ExprStmt',
      expr: { k: 'WhenExpr', subject: { k: 'Ident', name: 'x' } },
    })
  })
})
```

- [ ] **Step 7: Chạy toàn bộ test + lint + typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: sạch. `parser-stmt.test.ts` giờ có 15 test.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(engine): parser khai báo hàm và chương trình"
```

---

### Task 7: Validator + diagnostics tiếng Việt

**Files:**
- Create: `src/engine/validator/diagnostics.ts`
- Create: `src/engine/validator/validator.ts`
- Test: `tests/engine/validator.test.ts`

**Interfaces:**
- Consumes: `Program`, `Expr`, `Stmt`, `parseProgram` (Task 6)
- Produces: `Diagnostic`, `validate(program: Program): Diagnostic[]`, `UNSUPPORTED: Record<string, string>`

- [ ] **Step 1: Viết test thất bại**

`tests/engine/validator.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseProgram } from '../../src/engine/parser/parser'
import { validate } from '../../src/engine/validator/validator'

const check = (src: string) => validate(parseProgram(src))

describe('validator', () => {
  it('code hợp lệ không sinh chẩn đoán', () => {
    expect(check('fun main() = runBlocking {\n  launch { delay(1) }\n}')).toEqual([])
  })

  it('báo construct chưa hỗ trợ kèm đúng số dòng', () => {
    const d = check('fun main() = runBlocking {\n  val c = Channel<Int>()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.message).toContain('Channel')
    expect(d[0]!.message).toContain('chưa được hỗ trợ')
  })

  it('gợi ý cách thay thế cho construct chưa hỗ trợ', () => {
    const d = check('fun main() {\n  select { }\n}')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('báo lỗi khi thiếu fun main', () => {
    const d = check('fun other() {\n}')
    expect(d.some(x => x.message.includes('main'))).toBe(true)
  })

  it('gom nhiều lỗi chứ không dừng ở lỗi đầu', () => {
    const d = check('fun main() {\n  Channel<Int>()\n  select { }\n}')
    expect(d.length).toBeGreaterThanOrEqual(2)
  })

  it('nhận diện toán tử Flow chưa hỗ trợ gọi kiểu thành viên', () => {
    // Đường Member là đường DUY NHẤT bắt được buffer/conflate/debounce/
    // combine/zip — 5/13 mục trong danh mục. Phải test bằng một tên THẬT SỰ
    // có trong UNSUPPORTED, và assert đúng mục đó, không phải mục khác lọt vào.
    const d = check('fun main() {\n  flowOf(1).buffer()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.message).toContain('buffer')
    expect(d[0]!.line).toBe(2)
  })

  it('nhận diện withLock ở dạng gọi thành viên, tách khỏi Mutex', () => {
    const d = check('fun main() {\n  m.withLock { }\n}')
    expect(d.some(x => x.message.includes('withLock'))).toBe(true)
  })

  it('gom lỗi trên NHIỀU hàm khác nhau, không chỉ trong một hàm', () => {
    const d = check('fun a() {\n  select { }\n}\nfun main() {\n  Channel<Int>()\n}')
    expect(d.map(x => x.line)).toEqual([2, 5])
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/validator.test.ts`
Expected: FAIL — không resolve được `validator`.

- [ ] **Step 2b: Điều kiện tiên quyết — parser phải đọc được đối số kiểu**

Validator sinh ra để báo lỗi đẹp cho construct chưa hỗ trợ. Nhưng `Channel<Int>()`
là cú pháp người dùng thật sự gõ, mà parser hiện chết ngay ở `<`. Kết quả là
người dùng nhận `"Không phân tích được biểu thức bắt đầu bằng '<'"` thay vì
`"Channel chưa được hỗ trợ, dùng Flow"` — hỏng đúng chỗ validator phục vụ.

M1 vứt bỏ kiểu, nên chỉ cần **nuốt qua** đối số kiểu, không cần dựng node.

Thêm vào class `Parser` trong `src/engine/parser/parser.ts`:

```ts
  /**
   * Phân biệt `Channel<Int>()` (đối số kiểu) với `a < b` (so sánh).
   *
   * Chỉ coi là đối số kiểu khi quét được tới '>' khớp cặp VÀ ngay sau đó là
   * '('. Nhờ điều kiện thứ hai mà `a < b` không bao giờ bị hiểu nhầm. Thất bại
   * thì khôi phục con trỏ về chỗ cũ, không để lại dấu vết.
   */
  private trySkipTypeArgs(): boolean {
    if (!this.at('OP', '<')) return false

    // Chỉ '>' theo sau bởi '(' là KHÔNG đủ: `x < y > (z)` cũng khớp mẫu đó và
    // sẽ bị nuốt thành Call(x, [z]) một cách im lặng — tệ hơn cả lỗi parse.
    // Chốt thêm bằng quy ước Kotlin: tên kiểu viết hoa chữ đầu.
    // Giới hạn đã biết: `x < Y > (z)` với Y là biến viết hoa vẫn nhầm. Chấp
    // nhận ở M1 — trình biên dịch thật phân giải chỗ này bằng thông tin kiểu
    // mà engine này không có, và subset M1 không cho user tự định nghĩa generic.
    const first = this.peek(1)
    if (first.kind !== 'IDENT' || !/^[A-Z]/.test(first.text)) return false

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
```

Trong `parsePostfix`, thêm nhánh **trước** nhánh `LPAREN`:
```ts
      } else if (this.trySkipTypeArgs()) {
        // Đã nuốt <...>; vòng lặp kế sẽ thấy '(' và gọi parseCallTail.
      } else if (this.at('LPAREN')) {
```

Thêm vào cuối `tests/engine/parser-expr.test.ts`:
```ts
describe('parser — đối số kiểu', () => {
  it('Channel<Int>() parse thành lời gọi Channel', () => {
    expect(parseExprSource('Channel<Int>()')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'Channel' }, args: [],
    })
  })

  it('kiểu lồng nhau MutableStateFlow<List<Int>>(x)', () => {
    expect(parseExprSource('MutableStateFlow<List<Int>>(x)')).toMatchObject({
      k: 'Call', callee: { k: 'Ident', name: 'MutableStateFlow' },
      args: [{ value: { k: 'Ident', name: 'x' } }],
    })
  })

  it('a < b vẫn là so sánh, KHÔNG phải đối số kiểu', () => {
    expect(parseExprSource('a < b')).toMatchObject({ k: 'Binary', op: '<' })
    expect(parseExprSource('x < y + 1')).toMatchObject({ k: 'Binary', op: '<' })
  })

  it('x < y > (z) là so sánh chứ KHÔNG phải lời gọi generic', () => {
    // Ca nguy hiểm nhất: khớp đúng mẫu '<' ... '>' rồi '(' nhưng lại là
    // so sánh. Nếu nuốt nhầm sẽ ra Call(x,[z]) và KHÔNG báo lỗi gì.
    expect(parseExprSource('x < y > (z)')).toMatchObject({
      k: 'Binary', op: '>',
      left: { k: 'Binary', op: '<', left: { k: 'Ident', name: 'x' } },
    })
  })

  it('dấu phẩy giữa hai so sánh trong đối số không bị gộp thành đối số kiểu', () => {
    // f(a < b, c > (d)) — dấu phẩy nằm trong whitelist nên đây là ca dễ lọt.
    const ast = parseExprSource('f(a < b, c > (d))')
    expect(ast).toMatchObject({ k: 'Call', callee: { k: 'Ident', name: 'f' } })
    expect((ast as { args: unknown[] }).args).toHaveLength(2)
  })
})
```

Run: `npx vitest run tests/engine/parser-expr.test.ts`
Expected: PASS — 19 test.

- [ ] **Step 3: Viết `diagnostics.ts`**

```ts
export interface Diagnostic {
  severity: 'error'
  message: string
  line: number
  col: number
  hint?: string
}

/** Tên -> gợi ý thay thế. Khoá là định danh xuất hiện trong code. */
export const UNSUPPORTED: Record<string, string> = {
  Channel: 'Channel chưa có ở v1. Dùng Flow để mô hình luồng giá trị.',
  produce: 'produce chưa có ở v1. Dùng flow { emit(...) }.',
  actor: 'actor chưa có ở v1.',
  select: 'select chưa có ở v1. Tách thành các nhánh await() riêng.',
  Mutex: 'Mutex chưa có ở v1. Ở M1 chưa mô phỏng tranh chấp tài nguyên.',
  withLock: 'withLock chưa có ở v1 (đi kèm Mutex).',
  Semaphore: 'Semaphore chưa có ở v1.',
  buffer: 'Toán tử buffer chưa có ở v1.',
  conflate: 'Toán tử conflate chưa có ở v1.',
  debounce: 'Toán tử debounce chưa có ở v1.',
  combine: 'Toán tử combine chưa có ở v1.',
  zip: 'Toán tử zip chưa có ở v1.',
  suspendCoroutine: 'suspendCoroutine chưa có ở v1.',
  suspendCancellableCoroutine: 'suspendCancellableCoroutine chưa có ở v1.',
}
```

- [ ] **Step 4: Viết `validator.ts`**

```ts
import type { Block, Expr, Program, Stmt } from '../ast/nodes'
import { UNSUPPORTED, type Diagnostic } from './diagnostics'

export function validate(program: Program): Diagnostic[] {
  const out: Diagnostic[] = []

  if (!program.funs.some(f => f.name === 'main')) {
    out.push({
      severity: 'error',
      message: 'Không tìm thấy fun main(). Chương trình cần một điểm vào tên main.',
      line: 1, col: 1,
      hint: 'Thêm: fun main() = runBlocking { ... }',
    })
  }

  const visitExpr = (e: Expr): void => {
    switch (e.k) {
      case 'Ident': {
        const hint = UNSUPPORTED[e.name]
        if (hint) out.push({
          severity: 'error',
          message: `'${e.name}' chưa được hỗ trợ ở phiên bản này.`,
          line: e.pos.line, col: e.pos.col, hint,
        })
        break
      }
      case 'Member': {
        const hint = UNSUPPORTED[e.name]
        if (hint) out.push({
          severity: 'error',
          message: `'${e.name}' chưa được hỗ trợ ở phiên bản này.`,
          line: e.pos.line, col: e.pos.col, hint,
        })
        visitExpr(e.target)
        break
      }
      case 'Call':
        visitExpr(e.callee)
        e.args.forEach(a => visitExpr(a.value))
        if (e.lambda) visitBlock(e.lambda.body)
        break
      case 'Binary': visitExpr(e.left); visitExpr(e.right); break
      case 'Range': visitExpr(e.from); visitExpr(e.to); break
      case 'Unary': visitExpr(e.operand); break
      case 'LambdaExpr': visitBlock(e.lambda.body); break
      case 'IfExpr':
        visitExpr(e.cond); visitBlock(e.thenBlock)
        if (e.elseBlock) visitBlock(e.elseBlock)
        break
      case 'WhenExpr':
        if (e.subject) visitExpr(e.subject)
        e.branches.forEach(b => { visitExpr(b.cond); visitBlock(b.block) })
        if (e.elseBlock) visitBlock(e.elseBlock)
        break
      case 'StringLit':
        e.parts.forEach(p => { if (p.type === 'expr') visitExpr(p.expr) })
        break
      default: break
    }
  }

  const visitStmt = (s: Stmt): void => {
    switch (s.k) {
      case 'ValDecl': visitExpr(s.init); break
      case 'Assign': visitExpr(s.target); visitExpr(s.value); break
      case 'ExprStmt': visitExpr(s.expr); break
      case 'While': visitExpr(s.cond); visitBlock(s.body); break
      case 'For': visitExpr(s.iterable); visitBlock(s.body); break
      case 'Throw': visitExpr(s.expr); break
      case 'Return': if (s.expr) visitExpr(s.expr); break
      case 'Try':
        visitBlock(s.body)
        s.catches.forEach(c => visitBlock(c.block))
        if (s.finallyBlock) visitBlock(s.finallyBlock)
        break
    }
  }

  const visitBlock = (b: Block): void => b.stmts.forEach(visitStmt)

  program.topLevel.forEach(visitStmt)
  program.funs.forEach(f => {
    f.params.forEach(p => { if (p.defaultValue) visitExpr(p.defaultValue) })
    if (f.body) visitBlock(f.body)
    if (f.exprBody) visitExpr(f.exprBody)
  })

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/validator.test.ts`
Expected: PASS — 8 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): validator + diagnostics tiếng Việt"
```

---

### Task 8: Trace — Event, emitter, fold ra WorldState

**Files:**
- Create: `src/engine/trace/events.ts`
- Create: `src/engine/trace/emitter.ts`
- Create: `src/engine/trace/world.ts`
- Test: `tests/engine/trace.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `JobId`, `ThreadId`, `FlowId`, `JobState`, `Event`, `TraceEmitter` (`emit`, `setClock`, `events`), `WorldState`, `foldTrace(events, upTo): WorldState`

- [ ] **Step 1: Viết `events.ts`**

```ts
export type JobId = string
export type ThreadId = string
export type FlowId = string

export type JobState = 'New' | 'Active' | 'Completing' | 'Completed' | 'Cancelling' | 'Cancelled'

export interface CtxSummary {
  dispatcher: string
  name: string | null
  isSupervisor: boolean
  hasHandler: boolean
}

export type EventBody =
  | { k: 'COROUTINE_CREATED'; id: JobId; parentId: JobId | null
      builder: 'launch' | 'async' | 'runBlocking' | 'coroutineScope' | 'supervisorScope' | 'withContext'
      ctx: CtxSummary }
  | { k: 'COROUTINE_STARTED'; id: JobId; threadId: ThreadId }
  | { k: 'COROUTINE_SUSPENDED'; id: JobId; reason: 'delay' | 'await' | 'join' | 'yield' | 'collect' | 'emit' }
  | { k: 'COROUTINE_RESUMED'; id: JobId; threadId: ThreadId }
  | { k: 'JOB_STATE'; id: JobId; from: JobState; to: JobState; cause?: string }
  | { k: 'EXCEPTION_THROWN'; id: JobId; exType: string; message: string }
  | { k: 'EXCEPTION_CAUGHT'; id: JobId; exType: string }
  | { k: 'FAILURE_PROPAGATED'; from: JobId; to: JobId; blockedBySupervisor: boolean }
  | { k: 'CANCEL_REQUESTED'; from: JobId | 'user'; to: JobId; cause: string }
  | { k: 'HANDLER_RECEIVED'; id: JobId; handler: 'CEH' | 'platform'; exType: string }
  | { k: 'DISPATCH'; id: JobId; dispatcher: string; threadId: ThreadId }
  | { k: 'THREAD_STATE'; threadId: ThreadId; state: 'RUNNING' | 'FREE' }
  | { k: 'PRINTLN'; id: JobId; text: string }

export type Event = EventBody & { seq: number; t: number; srcLine?: number }
```

- [ ] **Step 2: Viết test thất bại**

`tests/engine/trace.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { TraceEmitter } from '../../src/engine/trace/emitter'
import { foldTrace } from '../../src/engine/trace/world'

const sample = () => {
  const em = new TraceEmitter()
  em.emit({ k: 'COROUTINE_CREATED', id: 'j1', parentId: null, builder: 'runBlocking',
    ctx: { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false } })
  em.emit({ k: 'JOB_STATE', id: 'j1', from: 'New', to: 'Active' })
  em.setClock(100)
  em.emit({ k: 'PRINTLN', id: 'j1', text: 'hi' })
  em.emit({ k: 'JOB_STATE', id: 'j1', from: 'Active', to: 'Completed' })
  return em.events
}

describe('trace', () => {
  it('seq tăng đơn điệu từ 0', () => {
    expect(sample().map(e => e.seq)).toEqual([0, 1, 2, 3])
  })

  it('t lấy theo đồng hồ ảo tại thời điểm phát', () => {
    expect(sample().map(e => e.t)).toEqual([0, 0, 100, 100])
  })

  it('fold dựng đúng trạng thái job tại step cuối', () => {
    const w = foldTrace(sample(), 4)
    expect(w.jobs.get('j1')).toMatchObject({ state: 'Completed', builder: 'runBlocking' })
  })

  it('fold tới step giữa cho trạng thái trung gian', () => {
    const w = foldTrace(sample(), 2)
    expect(w.jobs.get('j1')!.state).toBe('Active')
    expect(w.output).toEqual([])
  })

  it('output println tích luỹ theo thứ tự', () => {
    expect(foldTrace(sample(), 4).output).toEqual(['hi'])
  })

  it('fold là hàm thuần — không phụ thuộc lần gọi trước đó', () => {
    const evs = sample()
    // Phải chụp BẢN SAO SÂU trước khi gọi cái có thể làm hỏng state.
    // Nếu chỉ giữ tham chiếu thì một foldTrace stateful (hoist WorldState ra
    // module scope) sẽ khiến biến này thay đổi theo, và phép so sánh cuối
    // suy biến thành x === x — luôn đúng, không phát hiện được gì.
    const straightToTwo = structuredClone(foldTrace(evs, 2))
    foldTrace(evs, evs.length)
    expect(foldTrace(evs, 2)).toEqual(straightToTwo)
  })

  it('mỗi lần gọi trả về đối tượng MỚI, không dùng lại state cũ', () => {
    // Đây mới là test thực sự chặn được kiểu hồi quy nói trên: so sánh
    // tham chiếu, thứ mà toEqual không bao giờ nhìn thấy.
    const evs = sample()
    const a = foldTrace(evs, 2)
    const b = foldTrace(evs, 2)
    expect(a).not.toBe(b)
    expect(a.jobs).not.toBe(b.jobs)
    expect(a.output).not.toBe(b.output)
    expect(a).toEqual(b)
  })

  it('foldTrace không làm thay đổi mảng event đầu vào', () => {
    const evs = sample()
    const before = structuredClone(evs)
    foldTrace(evs, evs.length)
    expect(evs).toEqual(before)
  })

  it('upTo vượt quá độ dài thì kẹp về step cuối', () => {
    const evs = sample()
    expect(foldTrace(evs, 999)).toEqual(foldTrace(evs, evs.length))
  })

  it('upTo âm cho trạng thái rỗng', () => {
    const w = foldTrace(sample(), -5)
    expect({ jobs: w.jobs.size, output: w.output }).toEqual({ jobs: 0, output: [] })
  })
})
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/trace.test.ts`
Expected: FAIL — không resolve được `emitter`.

- [ ] **Step 4: Viết `emitter.ts`**

```ts
import type { Event, EventBody } from './events'

export class TraceEmitter {
  private seq = 0
  private t = 0
  readonly events: Event[] = []

  setClock(t: number): void { this.t = t }
  get clock(): number { return this.t }

  /**
   * Lưu ý cho bên GỌI: body được spread NÔNG, nên object lồng bên trong
   * (vd ctx của COROUTINE_CREATED) được giữ theo THAM CHIẾU. Luôn dựng
   * object mới cho mỗi lần emit; dùng lại rồi sửa sẽ làm event lịch sử
   * đổi theo, phá vỡ tính 'trace là nguồn sự thật duy nhất'.
   */
  emit(body: EventBody, srcLine?: number): void {
    const e = { ...body, seq: this.seq++, t: this.t } as Event
    if (srcLine !== undefined) e.srcLine = srcLine
    this.events.push(e)
  }
}
```

- [ ] **Step 5: Viết `world.ts`**

```ts
import type { Event, JobId, JobState, ThreadId } from './events'

export interface JobView {
  id: JobId
  parentId: JobId | null
  builder: string
  state: JobState
  dispatcher: string
  name: string | null
  isSupervisor: boolean
  suspendReason: string | null
  threadId: ThreadId | null
  cause: string | null
}

export interface ThreadView { id: ThreadId; state: 'RUNNING' | 'FREE' }

export interface WorldState {
  t: number
  jobs: Map<JobId, JobView>
  threads: Map<ThreadId, ThreadView>
  output: string[]
  /** Edge failure/cancel đang hoạt động tại step này, để UI vẽ token. */
  lastEvent: Event | null
}

/** Dựng lại trạng thái bằng cách áp dụng event [0, upTo). Hàm thuần. */
export function foldTrace(events: readonly Event[], upTo: number): WorldState {
  const w: WorldState = { t: 0, jobs: new Map(), threads: new Map(), output: [], lastEvent: null }
  const n = Math.max(0, Math.min(upTo, events.length))

  for (let i = 0; i < n; i++) {
    const e = events[i]!
    w.t = e.t
    w.lastEvent = e

    switch (e.k) {
      case 'COROUTINE_CREATED':
        w.jobs.set(e.id, {
          id: e.id, parentId: e.parentId, builder: e.builder, state: 'New',
          dispatcher: e.ctx.dispatcher, name: e.ctx.name, isSupervisor: e.ctx.isSupervisor,
          suspendReason: null, threadId: null, cause: null,
        })
        break
      case 'JOB_STATE': {
        const j = w.jobs.get(e.id)
        if (j) { j.state = e.to; if (e.cause) j.cause = e.cause }
        break
      }
      case 'COROUTINE_STARTED':
      case 'COROUTINE_RESUMED': {
        const j = w.jobs.get(e.id)
        if (j) { j.threadId = e.threadId; j.suspendReason = null }
        break
      }
      case 'COROUTINE_SUSPENDED': {
        const j = w.jobs.get(e.id)
        if (j) { j.suspendReason = e.reason; j.threadId = null }
        break
      }
      case 'DISPATCH': {
        const j = w.jobs.get(e.id)
        if (j) j.threadId = e.threadId
        break
      }
      case 'THREAD_STATE':
        w.threads.set(e.threadId, { id: e.threadId, state: e.state })
        break
      case 'PRINTLN':
        w.output.push(e.text)
        break
      default:
        break
    }
  }
  return w
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/trace.test.ts`
Expected: PASS — 10 test.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): Event, TraceEmitter, foldTrace"
```

---

### Task 9: Job state machine

**Files:**
- Create: `src/engine/runtime/job.ts`
- Test: `tests/engine/runtime-job.test.ts`

**Interfaces:**
- Consumes: `JobId`, `JobState` (Task 8)
- Produces: `FailureCause`, `Job` class với `id`, `name`, `parent`, `children: readonly Job[]` (chỉ đọc), `isSupervisor`, `state`, `cause`, `addChild`, `transitionTo`, `isActive`, `isCompleted`, `isCancelled`, `descendants()`

- [ ] **Step 1: Viết test thất bại**

`tests/engine/runtime-job.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Job } from '../../src/engine/runtime/job'

describe('Job state machine', () => {
  it('khởi tạo ở trạng thái New', () => {
    expect(new Job('j1', 'root', null, false).state).toBe('New')
  })

  it('chuyển New -> Active -> Completing -> Completed', () => {
    const j = new Job('j1', 'root', null, false)
    j.transitionTo('Active'); j.transitionTo('Completing'); j.transitionTo('Completed')
    expect(j.state).toBe('Completed')
    expect(j.isCompleted).toBe(true)
  })

  it('chặn chuyển trạng thái không hợp lệ', () => {
    const j = new Job('j1', 'root', null, false)
    j.transitionTo('Active'); j.transitionTo('Completed')
    expect(() => j.transitionTo('Active')).toThrow(/không hợp lệ/)
  })

  it('addChild gắn hai chiều', () => {
    const p = new Job('p', 'parent', null, false)
    const c = new Job('c', 'child', p, false)
    p.addChild(c)
    expect(p.children).toEqual([c])
    expect(c.parent).toBe(p)
  })

  it('children giữ đúng thứ tự thêm — quyết định tính deterministic', () => {
    const p = new Job('p', 'parent', null, false)
    const ids = ['a', 'b', 'c']
    ids.forEach(id => p.addChild(new Job(id, id, p, false)))
    expect(p.children.map(c => c.id)).toEqual(ids)
  })

  it('descendants duyệt theo chiều sâu, thứ tự ổn định', () => {
    const root = new Job('r', 'r', null, false)
    const a = new Job('a', 'a', root, false); root.addChild(a)
    const b = new Job('b', 'b', root, false); root.addChild(b)
    const a1 = new Job('a1', 'a1', a, false); a.addChild(a1)
    expect(root.descendants().map(j => j.id)).toEqual(['a', 'a1', 'b'])
  })

  it('isActive chỉ đúng khi Active', () => {
    const j = new Job('j', 'j', null, false)
    expect(j.isActive).toBe(false)
    j.transitionTo('Active')
    expect(j.isActive).toBe(true)
  })

  it('isCancelled đúng sau khi Cancelled', () => {
    const j = new Job('j', 'j', null, false)
    j.transitionTo('Active'); j.transitionTo('Cancelling'); j.transitionTo('Cancelled')
    expect(j.isCancelled).toBe(true)
    expect(j.isCompleted).toBe(true)
  })

  it('state không có setter — chỉ đổi được qua transitionTo', () => {
    // Nếu state là field public thì mọi module hạ nguồn đều gán thẳng được
    // và bảng ALLOWED trở thành vô dụng.
    const desc = Object.getOwnPropertyDescriptor(Job.prototype, 'state')
    expect(desc?.get).toBeTypeOf('function')
    expect(desc?.set).toBeUndefined()
  })

  it('addChild ném lỗi khi child.parent không trỏ về job này', () => {
    const p = new Job('p', 'P', null, false)
    const other = new Job('o', 'O', null, false)
    const orphan = new Job('c', 'C', other, false)
    expect(() => p.addChild(orphan)).toThrow(/khớp hai chiều/)
  })

  it('addChild ném lỗi khi child không có parent', () => {
    const p = new Job('p', 'P', null, false)
    const rootless = new Job('c', 'C', null, false)
    expect(() => p.addChild(rootless)).toThrow(/khớp hai chiều/)
  })

  it('liên kết khớp hai chiều thì addChild chạy bình thường', () => {
    const p = new Job('p', 'P', null, false)
    const c = new Job('c', 'C', p, false)
    expect(() => p.addChild(c)).not.toThrow()
    expect(p.children).toEqual([c])
  })

  it('transitionTo về CHÍNH trạng thái hiện tại bị từ chối', () => {
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active')
    expect(() => j.transitionTo('Active')).toThrow(/không hợp lệ/)
  })

  it('New -> Cancelled đi thẳng được (job chưa chạy thì huỷ ngay)', () => {
    const j = new Job('j', 'J', null, false)
    expect(() => j.transitionTo('Cancelled')).not.toThrow()
    expect(j.isCancelled).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/runtime-job.test.ts`
Expected: FAIL — không resolve được `job`.

- [ ] **Step 3: Viết `job.ts`**

```ts
import type { JobId, JobState } from '../trace/events'

export interface FailureCause {
  exType: string
  message: string
  isCancellation: boolean
}

const ALLOWED: Record<JobState, readonly JobState[]> = {
  New: ['Active', 'Cancelling', 'Cancelled'],
  Active: ['Completing', 'Completed', 'Cancelling'],
  Completing: ['Completed', 'Cancelling'],
  Cancelling: ['Cancelled'],
  Completed: [],
  Cancelled: [],
}

export class Job {
  /**
   * Riêng tư, chỉ đổi được qua transitionTo. Nếu để public thì mọi module
   * hạ nguồn đều có thể gán thẳng `job.state = 'Cancelled'`, bỏ qua đúng
   * bảng ALLOWED mà class này sinh ra để canh.
   */
  private _state: JobState = 'New'
  cause: FailureCause | null = null

  /** Mảng, không phải Set — thứ tự phải ổn định để trace deterministic. */
  private readonly _children: Job[] = []

  constructor(
    readonly id: JobId,
    readonly name: string,
    readonly parent: Job | null,
    readonly isSupervisor: boolean,
  ) {}

  get state(): JobState { return this._state }

  /** readonly: thêm con bắt buộc qua addChild để liên kết luôn khớp hai chiều. */
  get children(): readonly Job[] { return this._children }

  get isActive(): boolean { return this._state === 'Active' }
  get isCompleted(): boolean { return this._state === 'Completed' || this._state === 'Cancelled' }
  get isCancelled(): boolean { return this._state === 'Cancelled' }

  /**
   * Liên kết cha-con phải khớp hai chiều. Nếu lệch, job con sẽ nằm ngoài
   * `children` của cha và bị BỎ SÓT khi lan cancel — sai lặng lẽ, không có
   * tín hiệu lỗi nào. Thà chết sớm ở đây còn hơn sai âm thầm ở Task 13.
   */
  addChild(child: Job): void {
    if (child.parent !== this) {
      throw new Error(
        `Job ${this.id}: addChild(${child.id}) nhưng child.parent không trỏ về job này. ` +
        'Liên kết cha-con phải khớp hai chiều.',
      )
    }
    this._children.push(child)
  }

  transitionTo(next: JobState): void {
    if (!ALLOWED[this._state].includes(next)) {
      throw new Error(`Job ${this.id}: chuyển trạng thái không hợp lệ ${this._state} -> ${next}`)
    }
    this._state = next
  }

  /** Duyệt sâu, thứ tự ổn định. */
  descendants(): Job[] {
    const out: Job[] = []
    const walk = (j: Job) => { for (const c of j.children) { out.push(c); walk(c) } }
    walk(this)
    return out
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/runtime-job.test.ts`
Expected: PASS — 14 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): Job state machine"
```

---

### Task 10: CoroutineContext

**Files:**
- Create: `src/engine/runtime/context.ts`
- Test: `tests/engine/runtime-context.test.ts`

**Interfaces:**
- Consumes: `Job` (Task 9), `CtxSummary` (Task 8)
- Produces: `CoroutineContext` với `job`, `dispatcher`, `name`, `handler`; `plus(other)`; `summary()`

- [ ] **Step 1: Viết test thất bại**

`tests/engine/runtime-context.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CoroutineContext } from '../../src/engine/runtime/context'
import { Job } from '../../src/engine/runtime/job'

describe('CoroutineContext', () => {
  it('rỗng thì dispatcher mặc định là Default', () => {
    expect(CoroutineContext.empty().dispatcher).toBe('Default')
  })

  it('plus ghi đè element cùng loại, bên phải thắng', () => {
    const a = CoroutineContext.empty().withDispatcher('IO')
    const b = CoroutineContext.empty().withDispatcher('Main')
    expect(a.plus(b).dispatcher).toBe('Main')
  })

  it('plus giữ element mà bên phải không có', () => {
    const a = CoroutineContext.empty().withName('worker')
    const b = CoroutineContext.empty().withDispatcher('IO')
    const c = a.plus(b)
    expect({ name: c.name, dispatcher: c.dispatcher }).toEqual({ name: 'worker', dispatcher: 'IO' })
  })

  it('mang được Job', () => {
    const j = new Job('j1', 'j1', null, true)
    expect(CoroutineContext.empty().withJob(j).job).toBe(j)
  })

  it('summary phản ánh supervisor và handler', () => {
    const j = new Job('j1', 'j1', null, true)
    const ctx = CoroutineContext.empty().withJob(j).withHandler('h').withName('w').withDispatcher('IO')
    expect(ctx.summary()).toEqual({
      dispatcher: 'IO', name: 'w', isSupervisor: true, hasHandler: true,
    })
  })

  it('plus không làm thay đổi context gốc', () => {
    const a = CoroutineContext.empty().withDispatcher('IO')
    a.plus(CoroutineContext.empty().withDispatcher('Main'))
    expect(a.dispatcher).toBe('IO')
  })

  it('vế phải KHÔNG đặt dispatcher thì giữ nguyên của vế trái', () => {
    // ĐÂY là lý do tồn tại của việc lưu element dạng T|null. Một bản cài đặt
    // gộp "chưa đặt" với giá trị mặc định 'Default' sẽ reset IO về Default ở
    // đây — mà vẫn pass mọi test khác, vì các test kia đều đặt dispatcher
    // tường minh ở vế phải.
    const ctx = CoroutineContext.empty().withDispatcher('IO')
      .plus(CoroutineContext.empty().withName('worker'))
    expect(ctx.dispatcher).toBe('IO')
    expect(ctx.name).toBe('worker')
  })

  it("đặt 'Default' TƯỜNG MINH ở vế phải vẫn ghi đè được IO", () => {
    // 'Default' là giá trị miền hợp lệ, khác hẳn với "chưa đặt" (null).
    const ctx = CoroutineContext.empty().withDispatcher('IO')
      .plus(CoroutineContext.empty().withDispatcher('Default'))
    expect(ctx.dispatcher).toBe('Default')
  })

  it('plus giữ job và handler khi vế phải không đặt', () => {
    const j = new Job('j1', 'j1', null, false)
    const ctx = CoroutineContext.empty().withJob(j).withHandler('CEH')
      .plus(CoroutineContext.empty().withName('w'))
    expect(ctx.job).toBe(j)
    expect(ctx.handler).toBe('CEH')
  })

  it('summary của context rỗng: không supervisor, không handler', () => {
    expect(CoroutineContext.empty().summary()).toEqual({
      dispatcher: 'Default', name: null, isSupervisor: false, hasHandler: false,
    })
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/runtime-context.test.ts`
Expected: FAIL — không resolve được `context`.

- [ ] **Step 3: Viết `context.ts`**

```ts
import type { CtxSummary } from '../trace/events'
import type { Job } from './job'

export class CoroutineContext {
  /**
   * Mọi element lưu dạng `T | null`, trong đó null nghĩa là "chưa đặt".
   * Phân biệt này là bắt buộc: plus() phải biết bên phải có thực sự đặt
   * dispatcher hay không, chứ không thể đoán từ giá trị mặc định.
   */
  private constructor(
    readonly job: Job | null,
    private readonly dispatcherOrNull: string | null,
    readonly name: string | null,
    readonly handler: string | null,
  ) {}

  static empty(): CoroutineContext {
    return new CoroutineContext(null, null, null, null)
  }

  /** Giá trị dùng thật khi chạy; chưa đặt thì là Default, giống Kotlin. */
  get dispatcher(): string { return this.dispatcherOrNull ?? 'Default' }

  withJob(job: Job): CoroutineContext {
    return new CoroutineContext(job, this.dispatcherOrNull, this.name, this.handler)
  }
  withDispatcher(d: string): CoroutineContext {
    return new CoroutineContext(this.job, d, this.name, this.handler)
  }
  withName(n: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, n, this.handler)
  }
  withHandler(h: string): CoroutineContext {
    return new CoroutineContext(this.job, this.dispatcherOrNull, this.name, h)
  }

  /** Toán tử + của Kotlin: element bên phải ghi đè element cùng loại bên trái. */
  plus(other: CoroutineContext): CoroutineContext {
    return new CoroutineContext(
      other.job ?? this.job,
      other.dispatcherOrNull ?? this.dispatcherOrNull,
      other.name ?? this.name,
      other.handler ?? this.handler,
    )
  }

  summary(): CtxSummary {
    return {
      dispatcher: this.dispatcher,
      name: this.name,
      isSupervisor: this.job?.isSupervisor ?? false,
      hasHandler: this.handler !== null,
    }
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/runtime-context.test.ts`
Expected: PASS — 10 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): CoroutineContext"
```

---

### Task 11: Đồng hồ ảo

**Files:**
- Create: `src/engine/runtime/clock.ts`
- Test: `tests/engine/runtime-clock.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `VirtualClock` với `now`, `schedule(atMs, fn): timerId`, `cancel(timerId)`, `advanceToNextTimer(): boolean`, `hasPendingTimers`

- [ ] **Step 1: Viết test thất bại**

`tests/engine/runtime-clock.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../src/engine/runtime/clock'

describe('VirtualClock', () => {
  it('bắt đầu ở 0', () => {
    expect(new VirtualClock().now).toBe(0)
  })

  it('advance nhảy tới timer gần nhất và chạy callback', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    expect(c.advanceToNextTimer()).toBe(true)
    expect({ now: c.now, fired }).toEqual({ now: 100, fired: ['a'] })
  })

  it('chạy timer theo thứ tự thời gian tăng dần', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(300, () => fired.push('c'))
    c.schedule(100, () => fired.push('a'))
    c.schedule(200, () => fired.push('b'))
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['a', 'b', 'c'])
  })

  it('timer cùng thời điểm chạy theo thứ tự đăng ký — bảo đảm deterministic', () => {
    // Test này chốt HỢP ĐỒNG mà scheduler dựa vào, không chốt cơ chế.
    // Ghi chú trung thực: tiêu chí phụ `a.seq - b.seq` trong comparator là
    // THỪA về mặt chức năng — Array.sort ổn định từ ES2019 nên thứ tự chèn
    // vốn đã được giữ. Đã kiểm chứng bằng thực nghiệm: bỏ tiêu chí đó đi
    // test vẫn xanh. Giữ lại vì nó nói rõ ý đồ và vẫn đúng nếu sau này đổi
    // sang cấu trúc khác (heap chẳng hạn) vốn không ổn định.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => fired.push('a'))
    c.schedule(50, () => fired.push('sớm'))
    c.schedule(100, () => fired.push('b'))
    c.schedule(100, () => fired.push('c'))
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['sớm', 'a', 'b', 'c'])
  })

  it('timer đặt CÙNG MỐC trong lúc callback chạy vẫn nổ, không rơi mất', () => {
    // delay(0) lồng nhau sinh ra đúng tình huống này. Phải dùng CÙNG mốc:
    // nếu đặt ở mốc khác thì vòng lặp advanceToNextTimer sẽ nhặt được ở lượt
    // sau bất kể cài đặt thế nào, và test mất khả năng phân biệt.
    const c = new VirtualClock()
    const fired: string[] = []
    c.schedule(100, () => {
      fired.push('ngoài')
      c.schedule(100, () => fired.push('trong'))
    })
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(fired).toEqual(['ngoài', 'trong'])
    expect(c.now).toBe(100)
  })

  it('timer tự đặt lại chính nó không làm treo vòng lặp vô hạn', () => {
    const c = new VirtualClock()
    let n = 0
    const tick = () => { if (++n < 3) c.schedule(c.now, tick) }
    c.schedule(10, tick)
    while (c.advanceToNextTimer()) { /* chạy hết */ }
    expect(n).toBe(3)
    expect(c.now).toBe(10)
  })

  it('cancel gỡ timer chưa chạy', () => {
    const c = new VirtualClock()
    const fired: string[] = []
    const id = c.schedule(100, () => fired.push('a'))
    c.cancel(id)
    expect(c.advanceToNextTimer()).toBe(false)
    expect(fired).toEqual([])
  })

  it('advance trả false khi hết timer', () => {
    expect(new VirtualClock().advanceToNextTimer()).toBe(false)
  })

  it('thời gian không bao giờ lùi', () => {
    const c = new VirtualClock()
    c.schedule(100, () => {})
    c.advanceToNextTimer()
    c.schedule(50, () => {})
    c.advanceToNextTimer()
    expect(c.now).toBe(100)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/runtime-clock.test.ts`
Expected: FAIL — không resolve được `clock`.

- [ ] **Step 3: Viết `clock.ts`**

```ts
interface Timer { id: number; at: number; seq: number; fn: () => void }

export class VirtualClock {
  private t = 0
  private nextId = 1
  private seq = 0
  private timers: Timer[] = []

  get now(): number { return this.t }
  get hasPendingTimers(): boolean { return this.timers.length > 0 }

  schedule(atMs: number, fn: () => void): number {
    const id = this.nextId++
    this.timers.push({ id, at: Math.max(atMs, this.t), seq: this.seq++, fn })
    return id
  }

  cancel(id: number): void {
    const i = this.timers.findIndex(x => x.id === id)
    if (i >= 0) this.timers.splice(i, 1)
  }

  /**
   * Nhảy tới mốc thời gian gần nhất và chạy MỌI timer đúng mốc đó,
   * theo thứ tự đăng ký. Trả false nếu không còn timer nào.
   */
  advanceToNextTimer(): boolean {
    if (this.timers.length === 0) return false
    this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
    const at = this.timers[0]!.at
    this.t = Math.max(this.t, at)
    const due: Timer[] = []
    while (this.timers.length > 0 && this.timers[0]!.at === at) due.push(this.timers.shift()!)
    for (const timer of due) timer.fn()
    return true
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/runtime-clock.test.ts`
Expected: PASS — 9 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): đồng hồ ảo"
```

---

### Task 12: Dispatcher và thread ảo

**Files:**
- Create: `src/engine/runtime/dispatcher.ts`
- Test: `tests/engine/runtime-dispatcher.test.ts`

**Interfaces:**
- Consumes: `JobId`, `ThreadId` (Task 8)
- Produces: `DISPATCHER_POOL_SIZE`, `VirtualThread`, `DispatcherPool` với `acquire(dispatcher, jobId): ThreadId | null`, `release(threadId)`, `threadsOf(dispatcher)`, `allThreads()`

- [ ] **Step 1: Viết test thất bại**

`tests/engine/runtime-dispatcher.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DispatcherPool, DISPATCHER_POOL_SIZE } from '../../src/engine/runtime/dispatcher'

describe('DispatcherPool', () => {
  it('Main chỉ có đúng 1 thread', () => {
    expect(DISPATCHER_POOL_SIZE.Main).toBe(1)
  })

  it('acquire trả thread rảnh đầu tiên', () => {
    const p = new DispatcherPool()
    expect(p.acquire('Main', 'j1')).toBe('Main-1')
  })

  it('Main hết thread thì acquire trả null', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'j1')
    expect(p.acquire('Main', 'j2')).toBeNull()
  })

  it('release trả thread về pool', () => {
    const p = new DispatcherPool()
    const t = p.acquire('Main', 'j1')!
    p.release(t)
    expect(p.acquire('Main', 'j2')).toBe('Main-1')
  })

  it('Default có nhiều thread, cấp phát theo thứ tự ổn định', () => {
    const p = new DispatcherPool()
    expect([p.acquire('Default', 'a'), p.acquire('Default', 'b')]).toEqual(['Default-1', 'Default-2'])
  })

  it('thread của dispatcher khác nhau độc lập', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'j1')
    expect(p.acquire('IO', 'j2')).toBe('IO-1')
  })

  it('allThreads gom theo dispatcher, thứ tự dispatcher theo lần dùng đầu tiên', () => {
    // KHÔNG so sánh allThreads() với chính nó — phép đó luôn đúng và không
    // kiểm được gì. Phải khẳng định thứ tự CỤ THỂ.
    const p = new DispatcherPool()
    p.acquire('IO', 'a')     // IO được dùng trước
    p.acquire('Main', 'b')
    const ids = p.allThreads().map(t => t.id)
    expect(ids.slice(0, 8)).toEqual([
      'IO-1', 'IO-2', 'IO-3', 'IO-4', 'IO-5', 'IO-6', 'IO-7', 'IO-8',
    ])
    expect(ids[8]).toBe('Main-1')
  })

  it('đảo thứ tự dùng thì allThreads đảo theo — chứng minh không hard-code', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'b')   // lần này Main trước
    p.acquire('IO', 'a')
    const ids = p.allThreads().map(t => t.id)
    expect(ids[0]).toBe('Main-1')
    expect(ids[1]).toBe('IO-1')
  })

  it('thread ghi lại job đang giữ nó', () => {
    const p = new DispatcherPool()
    const t = p.acquire('IO', 'j9')!
    expect(p.allThreads().find(x => x.id === t)!.jobId).toBe('j9')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/runtime-dispatcher.test.ts`
Expected: FAIL — không resolve được `dispatcher`.

- [ ] **Step 3: Viết `dispatcher.ts`**

```ts
import type { JobId, ThreadId } from '../trace/events'

/** Số thread ảo mỗi dispatcher. Nhỏ hơn thực tế để hình vẽ đọc được. */
export const DISPATCHER_POOL_SIZE: Record<string, number> = {
  Main: 1,
  Default: 4,
  IO: 8,
  Unconfined: 1,
}

export interface VirtualThread {
  id: ThreadId
  dispatcher: string
  jobId: JobId | null
}

export class DispatcherPool {
  private readonly threads = new Map<ThreadId, VirtualThread>()
  /** Thứ tự dispatcher được tạo, để allThreads ổn định. */
  private readonly order: string[] = []

  private ensure(dispatcher: string): VirtualThread[] {
    if (!this.order.includes(dispatcher)) {
      this.order.push(dispatcher)
      const n = DISPATCHER_POOL_SIZE[dispatcher] ?? 1
      for (let i = 1; i <= n; i++) {
        const id = `${dispatcher}-${i}`
        this.threads.set(id, { id, dispatcher, jobId: null })
      }
    }
    return this.threadsOf(dispatcher)
  }

  threadsOf(dispatcher: string): VirtualThread[] {
    return [...this.threads.values()].filter(t => t.dispatcher === dispatcher)
  }

  allThreads(): VirtualThread[] {
    return this.order.flatMap(d => this.threadsOf(d))
  }

  /** Trả thread rảnh đầu tiên, hoặc null nếu pool đã đầy. */
  acquire(dispatcher: string, jobId: JobId): ThreadId | null {
    const free = this.ensure(dispatcher).find(t => t.jobId === null)
    if (!free) return null
    free.jobId = jobId
    return free.id
  }

  release(threadId: ThreadId): void {
    const t = this.threads.get(threadId)
    if (t) t.jobId = null
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/runtime-dispatcher.test.ts`
Expected: PASS — 9 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): dispatcher và thread ảo"
```

---

### Task 13: Luật lan truyền — trái tim ngữ nghĩa

**Files:**
- Create: `src/engine/runtime/propagation.ts`
- Test: `tests/engine/runtime-propagation.test.ts`

**Interfaces:**
- Consumes: `Job`, `FailureCause` (Task 9), `TraceEmitter` (Task 8)
- Produces: `cancelJob(job, cause, emitter, from)`, `reportFailure(child, cause, emitter)`

**Đây là task quan trọng nhất của M1.** Đây là nơi tập trung toàn bộ ngữ nghĩa mà người học cần đúng. Sai ở đây thì cả công cụ dạy sai.

- [ ] **Step 1: Viết test thất bại**

`tests/engine/runtime-propagation.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Job } from '../../src/engine/runtime/job'
import { cancelJob, reportFailure } from '../../src/engine/runtime/propagation'
import { TraceEmitter } from '../../src/engine/trace/emitter'

const boom = { exType: 'RuntimeException', message: 'boom', isCancellation: false }
const cancelled = { exType: 'CancellationException', message: 'cancelled', isCancellation: true }

/** parent + 3 con, tất cả Active. */
function tree(supervisor: boolean) {
  const p = new Job('p', 'Parent', null, supervisor)
  p.transitionTo('Active')
  const kids = ['a', 'b', 'c'].map(id => {
    const j = new Job(id, id.toUpperCase(), p, false)
    j.transitionTo('Active')
    p.addChild(j)
    return j
  })
  return { p, a: kids[0]!, b: kids[1]!, c: kids[2]! }
}

describe('propagation — cancel đi xuống', () => {
  it('cancel parent làm mọi child Cancelled', () => {
    const { p, a, b, c } = tree(false)
    cancelJob(p, cancelled, new TraceEmitter(), 'user')
    expect([p.state, a.state, b.state, c.state]).toEqual(
      ['Cancelled', 'Cancelled', 'Cancelled', 'Cancelled'])
  })

  it('cancel lan tới cháu, không chỉ con trực tiếp', () => {
    const { p, a } = tree(false)
    const g = new Job('g', 'G', a, false); g.transitionTo('Active'); a.addChild(g)
    cancelJob(p, cancelled, new TraceEmitter(), 'user')
    expect(g.state).toBe('Cancelled')
  })

  it('phát CANCEL_REQUESTED cho chính job bị cancel rồi tới từng child', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const evs = em.events.filter(e => e.k === 'CANCEL_REQUESTED')
    expect(evs.map(e => [(e as { from: string }).from, (e as { to: string }).to])).toEqual([
      ['user', 'p'], ['p', 'a'], ['p', 'b'], ['p', 'c'],
    ])
  })

  it('không phát CANCEL_REQUESTED trùng cho cùng một job', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const targets = em.events.filter(e => e.k === 'CANCEL_REQUESTED').map(e => (e as { to: string }).to)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('cancel job đã Completed không gây lỗi', () => {
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active'); j.transitionTo('Completed')
    expect(() => cancelJob(j, cancelled, new TraceEmitter(), 'user')).not.toThrow()
    expect(j.state).toBe('Completed')
  })

  it('phát JOB_STATE đủ hai chặng Active->Cancelling->Cancelled', () => {
    // UI vẽ chặng Cancelling; nếu nhảy thẳng sang Cancelled thì mất một bước
    // của hoạt cảnh và người học không thấy được giai đoạn "đang huỷ".
    const j = new Job('j', 'J', null, false)
    j.transitionTo('Active')
    const em = new TraceEmitter()
    cancelJob(j, cancelled, em, 'user')
    const states = em.events
      .filter(e => e.k === 'JOB_STATE')
      .map(e => [(e as { from: string }).from, (e as { to: string }).to])
    expect(states).toEqual([['Active', 'Cancelling'], ['Cancelling', 'Cancelled']])
  })

  it('con bị cancel TRƯỚC cha — thứ tự này là thứ tự UI vẽ', () => {
    const { p } = tree(false)
    const em = new TraceEmitter()
    cancelJob(p, cancelled, em, 'user')
    const order = em.events
      .filter(e => e.k === 'JOB_STATE' && (e as { to: string }).to === 'Cancelled')
      .map(e => (e as { id: string }).id)
    expect(order).toEqual(['a', 'b', 'c', 'p'])
  })
})

describe('propagation — failure đi lên', () => {
  it('child fail làm parent thường FAIL', () => {
    const { p, b } = tree(false)
    reportFailure(b, boom, new TraceEmitter())
    expect(p.state).toBe('Cancelled')
    expect(p.cause?.exType).toBe('RuntimeException')
  })

  it('parent fail rồi cancel các sibling', () => {
    const { a, b, c } = tree(false)
    reportFailure(b, boom, new TraceEmitter())
    expect([a.state, c.state]).toEqual(['Cancelled', 'Cancelled'])
  })

  it('phát FAILURE_PROPAGATED với blockedBySupervisor false', () => {
    const { b } = tree(false)
    const em = new TraceEmitter()
    reportFailure(b, boom, em)
    const ev = em.events.find(e => e.k === 'FAILURE_PROPAGATED')
    expect(ev).toMatchObject({ from: 'b', to: 'p', blockedBySupervisor: false })
  })

  it('CancellationException KHÔNG làm parent fail', () => {
    const { p, a, c } = tree(false)
    const b = new Job('b2', 'B2', p, false); b.transitionTo('Active'); p.addChild(b)
    reportFailure(b, cancelled, new TraceEmitter())
    expect([p.state, a.state, c.state]).toEqual(['Active', 'Active', 'Active'])
  })
})

describe('propagation — supervisor boundary', () => {
  it('supervisor KHÔNG fail khi direct child fail', () => {
    const { p, b } = tree(true)
    reportFailure(b, boom, new TraceEmitter())
    expect(p.state).toBe('Active')
  })

  it('sibling vẫn Active khi supervisor chặn failure', () => {
    const { a, c, b } = tree(true)
    reportFailure(b, boom, new TraceEmitter())
    expect([a.state, c.state]).toEqual(['Active', 'Active'])
  })

  it('phát FAILURE_PROPAGATED với blockedBySupervisor true', () => {
    const { b } = tree(true)
    const em = new TraceEmitter()
    reportFailure(b, boom, em)
    expect(em.events.find(e => e.k === 'FAILURE_PROPAGATED'))
      .toMatchObject({ from: 'b', to: 'p', blockedBySupervisor: true })
  })

  it('BẪY: supervisor chỉ chắn direct child — cháu vẫn theo luật Job thường', () => {
    // root(supervisor) -> P(thường) -> A, B, C
    const root = new Job('root', 'Root', null, true); root.transitionTo('Active')
    const P = new Job('P', 'P', root, false); P.transitionTo('Active'); root.addChild(P)
    const kids = ['A', 'B', 'C'].map(id => {
      const j = new Job(id, id, P, false); j.transitionTo('Active'); P.addChild(j); return j
    })
    reportFailure(kids[1]!, boom, new TraceEmitter())
    expect(P.state).toBe('Cancelled')          // P thường -> fail
    expect(kids[0]!.state).toBe('Cancelled')   // sibling bị kéo theo
    expect(kids[2]!.state).toBe('Cancelled')
    expect(root.state).toBe('Active')          // nhưng supervisor gốc vẫn sống
  })

  it('root fail (không có parent) vẫn ghi nhận cause', () => {
    const j = new Job('j', 'J', null, false); j.transitionTo('Active')
    reportFailure(j, boom, new TraceEmitter())
    expect(j.cause?.exType).toBe('RuntimeException')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/runtime-propagation.test.ts`
Expected: FAIL — không resolve được `propagation`.

- [ ] **Step 3: Viết `propagation.ts`**

```ts
import type { TraceEmitter } from '../trace/emitter'
import type { JobId } from '../trace/events'
import type { FailureCause, Job } from './job'

/**
 * Cancel đi XUỐNG: cancel một Job kéo theo toàn bộ descendant.
 * Idempotent — gọi trên Job đã kết thúc là no-op.
 */
export function cancelJob(
  job: Job,
  cause: FailureCause,
  emitter: TraceEmitter,
  from: JobId | 'user',
): void {
  if (job.isCompleted) return

  // Con trước, theo thứ tự khai báo — quyết định tính deterministic của trace.
  // Ghi lại chính hành động cancel này TRƯỚC khi lan xuống. Nếu bỏ, hành động
  // khởi đầu (user gọi job.cancel(), hay parent fail kéo theo) không hề xuất
  // hiện trong trace và UI không có gì để vẽ ở bước đầu tiên.
  emitter.emit({ k: 'CANCEL_REQUESTED', from, to: job.id, cause: cause.exType })

  for (const child of job.children) {
    if (child.isCompleted) continue
    cancelJob(child, cause, emitter, job.id)
  }

  const prev = job.state
  if (prev !== 'Cancelling') {
    job.transitionTo('Cancelling')
    emitter.emit({ k: 'JOB_STATE', id: job.id, from: prev, to: 'Cancelling', cause: cause.exType })
  }
  job.cause = cause
  job.transitionTo('Cancelled')
  emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType })
}

/**
 * Failure đi LÊN. Ba luật, đúng theo kotlinx.coroutines:
 *
 * 1. CancellationException là kết thúc bình thường — KHÔNG làm parent fail.
 * 2. Parent thường: fail theo, rồi cancel mọi sibling còn lại.
 * 3. Parent là supervisor: chặn tại boundary — parent không fail,
 *    sibling không bị đụng tới. (Exception chưa xử lý vẫn đi tiếp tới
 *    handler — việc đó do scheduler làm, không phải ở đây.)
 */
export function reportFailure(child: Job, cause: FailureCause, emitter: TraceEmitter): void {
  child.cause = cause

  if (!child.isCompleted) {
    const prev = child.state
    if (prev !== 'Cancelling') {
      child.transitionTo('Cancelling')
      emitter.emit({ k: 'JOB_STATE', id: child.id, from: prev, to: 'Cancelling', cause: cause.exType })
    }
    child.transitionTo('Cancelled')
    emitter.emit({ k: 'JOB_STATE', id: child.id, from: 'Cancelling', to: 'Cancelled', cause: cause.exType })
  }

  if (cause.isCancellation) return

  const parent = child.parent
  if (!parent) return

  emitter.emit({
    k: 'FAILURE_PROPAGATED',
    from: child.id,
    to: parent.id,
    blockedBySupervisor: parent.isSupervisor,
  })

  if (parent.isSupervisor) return

  parent.cause = cause
  cancelJob(parent, cause, emitter, child.id)
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/runtime-propagation.test.ts`
Expected: PASS — 16 test.

Nếu test "cancel parent làm mọi child Cancelled" fail vì `cancelJob` được gọi lại trên child đã Cancelled từ vòng lặp `reportFailure` → kiểm tra `isCompleted` ở đầu hàm đã chặn đúng chưa.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm test`
Expected: tất cả xanh.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): luật lan truyền cancel/failure/supervisor"
```

---

### Task 14: Scheduler

**Files:**
- Create: `src/engine/runtime/suspension.ts`
- Create: `src/engine/runtime/scheduler.ts`
- Test: `tests/engine/runtime-scheduler.test.ts`

**Interfaces:**
- Consumes: `VirtualClock` (11), `DispatcherPool` (12), `Job` (9), `cancelJob`/`reportFailure` (13), `TraceEmitter` (8)
- Produces: `Suspension`, `CoroutineBody = Generator<Suspension, void, unknown>`, `Scheduler` với `spawn(job, ctx, body, builder)`, `runToCompletion()`, `emitter`

- [ ] **Step 1: Viết `suspension.ts`**

```ts
import type { JobId } from '../trace/events'

export type Suspension =
  | { s: 'delay'; ms: number }
  | { s: 'join'; jobId: JobId }
  | { s: 'await'; jobId: JobId }
  /** Chờ MỌI child của jobId kết thúc. coroutineScope/supervisorScope dùng cái này. */
  | { s: 'joinChildren'; jobId: JobId }
  | { s: 'yield' }

/** Thân coroutine: generator yield ra điểm suspend, nhận lại giá trị resume. */
export type CoroutineBody = Generator<Suspension, unknown, unknown>
```

- [ ] **Step 2: Viết test thất bại**

`tests/engine/runtime-scheduler.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Scheduler } from '../../src/engine/runtime/scheduler'
import type { CoroutineBody } from '../../src/engine/runtime/suspension'

const collectPrints = (s: Scheduler) =>
  s.emitter.events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text)

describe('Scheduler', () => {
  it('chạy một coroutine không suspend', () => {
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): CoroutineBody { s.println('hi') })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['hi'])
    expect(root.state).toBe('Completed')
  })

  it('delay đẩy thời gian ảo, không ngủ thật', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      yield { s: 'delay', ms: 1000 }
      s.println('sau delay')
    })
    const start = Date.now()
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['sau delay'])
    expect(s.clock.now).toBe(1000)
    expect(Date.now() - start).toBeLessThan(200) // không ngủ thật
  })

  it('hai coroutine xen kẽ theo thời gian delay', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      s.spawnChild(function* (): CoroutineBody {
        yield { s: 'delay', ms: 200 }; s.println('B')
      })
      s.spawnChild(function* (): CoroutineBody {
        yield { s: 'delay', ms: 100 }; s.println('A')
      })
      yield { s: 'delay', ms: 300 }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B'])
  })

  it('phát COROUTINE_SUSPENDED rồi COROUTINE_RESUMED', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody { yield { s: 'delay', ms: 10 } })
    s.runToCompletion()
    const kinds = s.emitter.events.map(e => e.k)
    expect(kinds).toContain('COROUTINE_SUSPENDED')
    expect(kinds).toContain('COROUTINE_RESUMED')
  })

  it('exception trong thân coroutine thành failure của Job', () => {
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): CoroutineBody {
      throw Object.assign(new Error('boom'), { kotlinType: 'RuntimeException' })
    })
    s.runToCompletion()
    expect(root.state).toBe('Cancelled')
    expect(root.cause?.exType).toBe('RuntimeException')
  })

  it('chạy lại cùng chương trình cho trace y hệt — deterministic', () => {
    const build = () => {
      const s = new Scheduler()
      s.spawnRoot(function* (): CoroutineBody {
        s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 50 }; s.println('x') })
        s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 50 }; s.println('y') })
        yield { s: 'delay', ms: 100 }
      })
      s.runToCompletion()
      return JSON.stringify(s.emitter.events)
    }
    expect(build()).toBe(build())
  })

  it('runToCompletion dừng, không lặp vô hạn khi hết việc', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody { yield { s: 'yield' } })
    s.runToCompletion()
    expect(s.emitter.events.length).toBeGreaterThan(0)
  })

  it('join thật sự chờ job kia xong rồi mới chạy tiếp', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      const child = s.spawnChild(function* (): CoroutineBody {
        yield { s: 'delay', ms: 100 }
        s.println('child xong')
      })
      yield { s: 'join', jobId: child.id }
      s.println('sau join')
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['child xong', 'sau join'])
  })

  it('join KHÔNG chặn đồng hồ ảo tiến lên — chống hồi quy deadlock', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      const child = s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 500 } })
      yield { s: 'join', jobId: child.id }
    })
    s.runToCompletion()
    expect(s.clock.now).toBe(500)
  })

  it('joinChildren chờ mọi child, kể cả child chậm nhất', () => {
    const s = new Scheduler()
    s.spawnRoot(rootJob => (function* (): CoroutineBody {
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 100 }; s.println('A') })
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 300 }; s.println('B') })
      yield { s: 'joinChildren', jobId: rootJob.id }
      s.println('scope xong')
    })())
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'scope xong'])
  })
})
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/runtime-scheduler.test.ts`
Expected: FAIL — không resolve được `scheduler`.

- [ ] **Step 4: Viết `scheduler.ts`**

```ts
import { TraceEmitter } from '../trace/emitter'
import type { JobId } from '../trace/events'
import { VirtualClock } from './clock'
import { CoroutineContext } from './context'
import { DispatcherPool } from './dispatcher'
import { Job, type FailureCause } from './job'
import { cancelJob, reportFailure } from './propagation'
import type { CoroutineBody, Suspension } from './suspension'

interface Task {
  job: Job
  ctx: CoroutineContext
  body: CoroutineBody
  /** Giá trị trả vào .next() ở lần resume tới. */
  resumeValue: unknown
  started: boolean
}

function toCause(err: unknown): FailureCause {
  if (err && typeof err === 'object' && 'kotlinType' in err) {
    const e = err as { kotlinType: string; message?: string }
    return {
      exType: e.kotlinType,
      message: e.message ?? '',
      isCancellation: e.kotlinType === 'CancellationException',
    }
  }
  return { exType: 'Exception', message: String(err), isCancellation: false }
}

export class Scheduler {
  readonly emitter = new TraceEmitter()
  readonly clock = new VirtualClock()
  readonly pool = new DispatcherPool()

  private nextJobId = 1
  private readonly ready: Task[] = []
  private readonly tasks = new Map<JobId, Task>()
  private currentJob: Job | null = null

  /**
   * Task đang chờ một job khác kết thúc. Mảng, không phải Map lồng, để thứ tự
   * đánh thức ổn định — đây là điều kiện cho trace deterministic.
   *
   * KHÔNG được cài chờ bằng cách tự lên lịch lại ở cùng mốc thời gian: làm vậy
   * thì `ready` không bao giờ rỗng, đồng hồ ảo không bao giờ nhảy, và mọi thứ
   * đứng hình. Waiter phải nằm NGOÀI `ready` cho tới khi điều kiện thoả.
   */
  private waiters: { task: Task; kind: 'job' | 'children'; targetId: JobId }[] = []

  private newJobId(): JobId { return `j${this.nextJobId++}` }

  println(text: string, srcLine?: number): void {
    this.emitter.emit({ k: 'PRINTLN', id: this.currentJob?.id ?? 'j0', text }, srcLine)
  }

  spawnRoot(makeBody: (job: Job) => CoroutineBody): Job {
    return this.spawn(null, false, 'runBlocking', CoroutineContext.empty().withDispatcher('Main'), makeBody)
  }

  /** Tiện ích cho unit test của Scheduler; interpreter dùng spawnChildOf. */
  spawnChild(makeBody: (job: Job) => CoroutineBody, builder: 'launch' | 'async' = 'launch'): Job {
    const parent = this.currentJob
    const ctx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    return this.spawn(parent, false, builder, ctx, makeBody)
  }

  /**
   * `makeBody` nhận chính Job vừa tạo, để thân coroutine biết jobId của mình
   * mà không cần biến trung gian (Task 16 dùng nó dựng Env con đúng scope).
   */
  spawn(
    parent: Job | null,
    isSupervisor: boolean,
    builder: 'launch' | 'async' | 'runBlocking' | 'coroutineScope' | 'supervisorScope' | 'withContext',
    ctx: CoroutineContext,
    makeBody: (job: Job) => CoroutineBody,
  ): Job {
    const id = this.newJobId()
    const job = new Job(id, ctx.name ?? id, parent, isSupervisor)
    parent?.addChild(job)

    const jobCtx = ctx.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
    })

    const task: Task = { job, ctx: jobCtx, body: makeBody(job), resumeValue: undefined, started: false }
    this.tasks.set(id, task)
    this.ready.push(task)
    return job
  }

  jobById(id: JobId | null): Job | null {
    return id ? this.tasks.get(id)?.job ?? null : null
  }

  /**
   * Đánh thức waiter có điều kiện đã thoả. Giữ nguyên thứ tự đăng ký.
   * Trả true nếu có waiter được đưa vào ready.
   */
  private sweepWaiters(): boolean {
    const still: typeof this.waiters = []
    let woke = false
    for (const w of this.waiters) {
      const done = w.kind === 'job'
        ? (this.tasks.get(w.targetId)?.job.isCompleted ?? true)
        : (this.tasks.get(w.targetId)?.job.children.every(c => c.isCompleted) ?? true)
      if (done) { this.ready.push(w.task); woke = true } else { still.push(w) }
    }
    this.waiters = still
    return woke
  }

  /** Chạy cho tới khi không còn task ready, không còn waiter thoả, không còn timer. */
  runToCompletion(): void {
    let guard = 0
    for (;;) {
      while (this.ready.length > 0) {
        if (++guard > 100_000) throw new Error('Scheduler: nghi ngờ lặp vô hạn')
        this.step(this.ready.shift()!)
        this.sweepWaiters()
      }
      // Waiter có thể đã thoả nhờ job vừa kết thúc — xử lý trước khi nhảy đồng hồ.
      if (this.sweepWaiters()) continue
      this.emitter.setClock(this.clock.now)
      if (!this.clock.advanceToNextTimer()) break
      this.emitter.setClock(this.clock.now)
      this.sweepWaiters()
    }
  }

  private step(task: Task): void {
    const { job } = task
    if (job.isCompleted) return

    const threadId = this.pool.acquire(task.ctx.dispatcher, job.id) ?? `${task.ctx.dispatcher}-1`
    this.currentJob = job

    if (!task.started) {
      task.started = true
      job.transitionTo('Active')
      this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'New', to: 'Active' })
      this.emitter.emit({ k: 'COROUTINE_STARTED', id: job.id, threadId })
    } else {
      this.emitter.emit({ k: 'COROUTINE_RESUMED', id: job.id, threadId })
    }
    this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'RUNNING' })

    let result: IteratorResult<Suspension, unknown>
    try {
      result = task.body.next(task.resumeValue)
    } catch (err) {
      this.pool.release(threadId)
      this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
      const cause = toCause(err)
      this.emitter.emit({ k: 'EXCEPTION_THROWN', id: job.id, exType: cause.exType, message: cause.message })
      reportFailure(job, cause, this.emitter)
      this.currentJob = null
      return
    }

    this.pool.release(threadId)
    this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
    this.currentJob = null

    if (result.done) {
      if (!job.isCompleted) {
        job.transitionTo('Completing')
        this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Active', to: 'Completing' })
        job.transitionTo('Completed')
        this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Completing', to: 'Completed' })
      }
      return
    }

    this.suspend(task, result.value)
  }

  private suspend(task: Task, s: Suspension): void {
    // 'joinChildren' không có trong schema Event — gom về 'join' khi ghi trace.
    const reason = s.s === 'joinChildren' ? 'join' : s.s
    this.emitter.emit({ k: 'COROUTINE_SUSPENDED', id: task.job.id, reason })

    switch (s.s) {
      case 'delay':
        this.clock.schedule(this.clock.now + s.ms, () => { this.ready.push(task) })
        break
      case 'yield':
        this.ready.push(task)
        break
      case 'join':
      case 'await': {
        const target = this.tasks.get(s.jobId)
        if (!target || target.job.isCompleted) { this.ready.push(task); break }
        this.waiters.push({ task, kind: 'job', targetId: s.jobId })
        break
      }
      case 'joinChildren': {
        const target = this.tasks.get(s.jobId)
        if (!target || target.job.children.every(c => c.isCompleted)) { this.ready.push(task); break }
        this.waiters.push({ task, kind: 'children', targetId: s.jobId })
        break
      }
    }
  }

  cancel(job: Job, cause: FailureCause): void {
    cancelJob(job, cause, this.emitter, 'user')
  }
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/runtime-scheduler.test.ts`
Expected: PASS — 10 test.

Nếu test "hai coroutine xen kẽ" cho thứ tự sai, kiểm tra `advanceToNextTimer` chạy hết timer cùng mốc trước khi trả về, và `ready` là FIFO (`shift`, không `pop`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): scheduler với thời gian ảo"
```

---

### Task 15: Interpreter — giá trị, môi trường, đánh giá lõi

**Files:**
- Create: `src/engine/interpreter/values.ts`
- Create: `src/engine/interpreter/env.ts`
- Create: `src/engine/interpreter/interpreter.ts`
- Test: `tests/engine/interpreter-core.test.ts`

**Interfaces:**
- Consumes: AST (Task 3–6), `Scheduler` (14), `Suspension` (14)
- Produces: `KValue`, `KotlinThrow`, `Env`, `Interpreter` với `evalExpr(e, env)`, `evalBlock(b, env)` — cả hai là generator `Generator<Suspension, KValue, unknown>`

- [ ] **Step 1: Viết `values.ts`**

```ts
import type { Lambda } from '../ast/nodes'
import type { Env } from './env'

export type KValue =
  | { t: 'unit' }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'str'; v: string }
  | { t: 'null' }
  | { t: 'lambda'; lambda: Lambda; env: Env }
  | { t: 'obj'; className: string; fields: Map<string, KValue> }
  | { t: 'range'; from: number; to: number }

export const UNIT: KValue = { t: 'unit' }

/** Exception của Kotlin, ném xuyên qua generator bằng cơ chế throw của JS. */
export class KotlinThrow extends Error {
  constructor(readonly kotlinType: string, readonly kotlinMessage: string) {
    super(`${kotlinType}: ${kotlinMessage}`)
  }
}

export function truthy(v: KValue): boolean {
  return v.t === 'bool' ? v.v : v.t !== 'null' && v.t !== 'unit'
}

export function display(v: KValue): string {
  switch (v.t) {
    case 'num': return Number.isInteger(v.v) ? String(v.v) : String(v.v)
    case 'str': return v.v
    case 'bool': return String(v.v)
    case 'null': return 'null'
    case 'unit': return 'kotlin.Unit'
    case 'range': return `${v.from}..${v.to}`
    case 'lambda': return 'Function'
    case 'obj': return v.className
  }
}
```

- [ ] **Step 2: Viết `env.ts`**

```ts
import type { JobId } from '../trace/events'
import type { KValue } from './values'

export class Env {
  private readonly vars = new Map<string, KValue>()

  /**
   * `ownerJobId` là coroutine scope bao quanh về mặt LEXICAL.
   * Nó phải sống trong Env chứ không phải trong state tạm của Scheduler:
   * `Scheduler.currentJob` bị đặt lại mỗi step(), nên sau một lần suspend/resume
   * thì `launch` bên trong `coroutineScope { }` sẽ gắn nhầm parent.
   * Env đi theo closure nên đúng cả khi nhiều coroutine xen kẽ nhau.
   */
  constructor(
    private readonly parent: Env | null = null,
    private readonly ownerJobId: JobId | null = null,
  ) {}

  /** Truyền jobId khi mở một coroutine scope mới; null nghĩa là kế thừa scope ngoài. */
  child(ownerJobId: JobId | null = null): Env { return new Env(this, ownerJobId) }

  get enclosingJobId(): JobId | null {
    return this.ownerJobId ?? this.parent?.enclosingJobId ?? null
  }

  declare(name: string, value: KValue): void { this.vars.set(name, value) }

  get(name: string): KValue | undefined {
    return this.vars.get(name) ?? this.parent?.get(name)
  }

  set(name: string, value: KValue): boolean {
    if (this.vars.has(name)) { this.vars.set(name, value); return true }
    return this.parent?.set(name, value) ?? false
  }
}
```

- [ ] **Step 3: Viết test thất bại**

`tests/engine/interpreter-core.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const printsOf = (src: string) => runSource(src).output

describe('interpreter — lõi', () => {
  it('println với literal', () => {
    expect(printsOf('fun main() {\n  println("hi")\n}')).toEqual(['hi'])
  })

  it('val và string template', () => {
    expect(printsOf('fun main() {\n  val x = 3\n  println("x=$x")\n}')).toEqual(['x=3'])
  })

  it('số học theo đúng độ ưu tiên', () => {
    expect(printsOf('fun main() {\n  println("${1 + 2 * 3}")\n}')).toEqual(['7'])
  })

  it('if/else', () => {
    expect(printsOf('fun main() {\n  if (1 < 2) { println("a") } else { println("b") }\n}')).toEqual(['a'])
  })

  it('for trên khoảng', () => {
    expect(printsOf('fun main() {\n  for (i in 1..3) { println("$i") }\n}')).toEqual(['1', '2', '3'])
  })

  it('while với var', () => {
    expect(printsOf('fun main() {\n  var i = 0\n  while (i < 3) { println("$i")\n    i = i + 1 }\n}'))
      .toEqual(['0', '1', '2'])
  })

  it('gọi hàm do user định nghĩa', () => {
    expect(printsOf('fun greet(n: String) {\n  println("hi $n")\n}\nfun main() {\n  greet("An")\n}'))
      .toEqual(['hi An'])
  })

  it('tham số mặc định', () => {
    expect(printsOf('fun f(n: Int = 5) {\n  println("$n")\n}\nfun main() {\n  f()\n}')).toEqual(['5'])
  })

  it('try/catch bắt được throw', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("boom") } catch (e: Exception) { println("caught") }\n}'))
      .toEqual(['caught'])
  })

  it('finally chạy kể cả khi có exception', () => {
    expect(printsOf(
      'fun main() {\n  try { throw RuntimeException("x") } catch (e: Exception) { println("c") } finally { println("f") }\n}'))
      .toEqual(['c', 'f'])
  })
})
```

- [ ] **Step 4: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/interpreter-core.test.ts`
Expected: FAIL — không resolve được `run`.

- [ ] **Step 5: Viết `interpreter.ts`**

```ts
import type { Block, Expr, FunDecl, Program, Stmt } from '../ast/nodes'
import type { Scheduler } from '../runtime/scheduler'
import type { Suspension } from '../runtime/suspension'
import { Env } from './env'
import { KotlinThrow, UNIT, display, truthy, type KValue } from './values'

export type Eval<T> = Generator<Suspension, T, unknown>

/** Lệnh `return` được cài bằng exception nội bộ, không lẫn với exception Kotlin. */
class ReturnSignal { constructor(readonly value: KValue) {} }

export class Interpreter {
  readonly globals = new Env()
  private readonly funs = new Map<string, FunDecl>()

  constructor(readonly scheduler: Scheduler, readonly program: Program) {
    program.funs.forEach(f => this.funs.set(f.name, f))
  }

  lookupFun(name: string): FunDecl | undefined { return this.funs.get(name) }

  *evalBlock(block: Block, env: Env): Eval<KValue> {
    let last: KValue = UNIT
    for (const s of block.stmts) last = yield* this.evalStmt(s, env)
    return last
  }

  *evalStmt(s: Stmt, env: Env): Eval<KValue> {
    switch (s.k) {
      case 'ValDecl': {
        env.declare(s.name, yield* this.evalExpr(s.init, env))
        return UNIT
      }
      case 'Assign': {
        const v = yield* this.evalExpr(s.value, env)
        if (s.target.k === 'Ident' && env.set(s.target.name, v)) return UNIT
        throw new KotlinThrow('IllegalStateException', 'Không gán được biến')
      }
      case 'ExprStmt': return yield* this.evalExpr(s.expr, env)
      case 'Throw': {
        const v = yield* this.evalExpr(s.expr, env)
        if (v.t === 'obj') {
          const msg = v.fields.get('message')
          throw new KotlinThrow(v.className, msg && msg.t === 'str' ? msg.v : '')
        }
        throw new KotlinThrow('Exception', display(v))
      }
      case 'Return': {
        throw new ReturnSignal(s.expr ? yield* this.evalExpr(s.expr, env) : UNIT)
      }
      case 'While': {
        let guard = 0
        while (truthy(yield* this.evalExpr(s.cond, env))) {
          if (++guard > 100_000) throw new KotlinThrow('IllegalStateException', 'Vòng lặp quá dài')
          yield* this.evalBlock(s.body, env.child())
        }
        return UNIT
      }
      case 'For': {
        const it = yield* this.evalExpr(s.iterable, env)
        if (it.t !== 'range') throw new KotlinThrow('IllegalArgumentException', 'for chỉ hỗ trợ khoảng a..b')
        for (let i = it.from; i <= it.to; i++) {
          const scope = env.child()
          scope.declare(s.name, { t: 'num', v: i })
          yield* this.evalBlock(s.body, scope)
        }
        return UNIT
      }
      case 'Try': {
        try {
          try {
            return yield* this.evalBlock(s.body, env.child())
          } catch (err) {
            if (!(err instanceof KotlinThrow)) throw err
            for (const c of s.catches) {
              if (c.type === 'Exception' || c.type === err.kotlinType
                  || (c.type === 'Throwable')) {
                const scope = env.child()
                scope.declare(c.name, {
                  t: 'obj', className: err.kotlinType,
                  fields: new Map([['message', { t: 'str', v: err.kotlinMessage } as KValue]]),
                })
                return yield* this.evalBlock(c.block, scope)
              }
            }
            throw err
          }
        } finally {
          // finally chạy xuyên qua yield — đây là lý do dùng generator.
          if (s.finallyBlock) yield* this.evalBlock(s.finallyBlock, env.child())
        }
      }
    }
  }

  *evalExpr(e: Expr, env: Env): Eval<KValue> {
    switch (e.k) {
      case 'NumberLit': return { t: 'num', v: e.value }
      case 'BoolLit': return { t: 'bool', v: e.value }
      case 'NullLit': return { t: 'null' }
      case 'StringLit': {
        let out = ''
        for (const p of e.parts) {
          out += p.type === 'text' ? p.value : display(yield* this.evalExpr(p.expr, env))
        }
        return { t: 'str', v: out }
      }
      case 'Ident': {
        const v = env.get(e.name)
        if (v) return v
        return { t: 'obj', className: e.name, fields: new Map() }
      }
      case 'Range': {
        const a = yield* this.evalExpr(e.from, env)
        const b = yield* this.evalExpr(e.to, env)
        if (a.t !== 'num' || b.t !== 'num') throw new KotlinThrow('IllegalArgumentException', 'Khoảng cần số')
        return { t: 'range', from: a.v, to: b.v }
      }
      case 'Unary': {
        const v = yield* this.evalExpr(e.operand, env)
        if (e.op === '-' && v.t === 'num') return { t: 'num', v: -v.v }
        if (e.op === '!') return { t: 'bool', v: !truthy(v) }
        return UNIT
      }
      case 'Binary': return yield* this.evalBinary(e, env)
      case 'LambdaExpr': return { t: 'lambda', lambda: e.lambda, env }
      case 'IfExpr': {
        if (truthy(yield* this.evalExpr(e.cond, env))) return yield* this.evalBlock(e.thenBlock, env.child())
        return e.elseBlock ? yield* this.evalBlock(e.elseBlock, env.child()) : UNIT
      }
      case 'WhenExpr': {
        for (const b of e.branches) {
          if (truthy(yield* this.evalExpr(b.cond, env))) return yield* this.evalBlock(b.block, env.child())
        }
        return e.elseBlock ? yield* this.evalBlock(e.elseBlock, env.child()) : UNIT
      }
      case 'Member': {
        const target = yield* this.evalExpr(e.target, env)
        if (target.t === 'obj') {
          const f = target.fields.get(e.name)
          if (f) return f
          return { t: 'obj', className: `${target.className}.${e.name}`, fields: new Map() }
        }
        return UNIT
      }
      case 'Call': return yield* this.evalCall(e, env)
    }
  }

  private *evalBinary(e: Expr & { k: 'Binary' }, env: Env): Eval<KValue> {
    if (e.op === '&&') {
      return truthy(yield* this.evalExpr(e.left, env))
        ? { t: 'bool', v: truthy(yield* this.evalExpr(e.right, env)) }
        : { t: 'bool', v: false }
    }
    if (e.op === '||') {
      return truthy(yield* this.evalExpr(e.left, env))
        ? { t: 'bool', v: true }
        : { t: 'bool', v: truthy(yield* this.evalExpr(e.right, env)) }
    }
    const l = yield* this.evalExpr(e.left, env)
    const r = yield* this.evalExpr(e.right, env)
    if (e.op === '+' && (l.t === 'str' || r.t === 'str')) {
      return { t: 'str', v: display(l) + display(r) }
    }
    if (l.t === 'num' && r.t === 'num') {
      switch (e.op) {
        case '+': return { t: 'num', v: l.v + r.v }
        case '-': return { t: 'num', v: l.v - r.v }
        case '*': return { t: 'num', v: l.v * r.v }
        case '/': return { t: 'num', v: Math.trunc(l.v / r.v) }
        case '%': return { t: 'num', v: l.v % r.v }
        case '<': return { t: 'bool', v: l.v < r.v }
        case '>': return { t: 'bool', v: l.v > r.v }
        case '<=': return { t: 'bool', v: l.v <= r.v }
        case '>=': return { t: 'bool', v: l.v >= r.v }
      }
    }
    if (e.op === '==' || e.op === '===') return { t: 'bool', v: display(l) === display(r) }
    if (e.op === '!=' || e.op === '!==') return { t: 'bool', v: display(l) !== display(r) }
    return UNIT
  }

  /** Task 16 thay thế bằng bản có coroutine builder. */
  protected *evalCall(e: Expr & { k: 'Call' }, env: Env): Eval<KValue> {
    const name = e.callee.k === 'Ident' ? e.callee.name : null

    if (name === 'println') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      this.scheduler.println(display(arg), e.pos.line)
      return UNIT
    }

    if (name && /^[A-Z]/.test(name)) {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return {
        t: 'obj', className: name,
        fields: new Map([['message', arg.t === 'str' ? arg : { t: 'str', v: '' } as KValue]]),
      }
    }

    if (name) {
      const fn = this.funs.get(name)
      if (fn) return yield* this.callFun(fn, e.args, env)
    }

    return UNIT
  }

  *callFun(fn: FunDecl, args: readonly { name: string | null; value: Expr }[], env: Env): Eval<KValue> {
    // Thân hàm không thấy biến cục bộ của caller, NHƯNG kế thừa coroutine scope
    // bao quanh — nhờ vậy launch bên trong một suspend fun gắn đúng cha.
    const scope = this.globals.child(env.enclosingJobId)
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i]!
      const byName = args.find(a => a.name === p.name)
      const positional = args[i] && args[i]!.name === null ? args[i]! : undefined
      const argExpr = byName?.value ?? positional?.value ?? p.defaultValue
      scope.declare(p.name, argExpr ? yield* this.evalExpr(argExpr, env) : UNIT)
    }
    try {
      if (fn.body) return yield* this.evalBlock(fn.body, scope)
      if (fn.exprBody) return yield* this.evalExpr(fn.exprBody, scope)
      return UNIT
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value
      throw err
    }
  }
}
```

- [ ] **Step 6: Viết `src/engine/run.ts` (cửa vào tạm, Task 17 hoàn chỉnh)**

```ts
import { parseProgram } from './parser/parser'
import { Interpreter } from './interpreter/interpreter'
import { Scheduler } from './runtime/scheduler'
import { validate } from './validator/validator'
import type { Diagnostic } from './validator/diagnostics'
import type { Event } from './trace/events'
import type { CoroutineBody } from './runtime/suspension'

export interface RunResult {
  diagnostics: Diagnostic[]
  events: Event[]
  output: string[]
}

export function runSource(src: string): RunResult {
  const program = parseProgram(src)
  const diagnostics = validate(program)
  if (diagnostics.length > 0) return { diagnostics, events: [], output: [] }

  const scheduler = new Scheduler()
  const interp = new Interpreter(scheduler, program)
  const main = interp.lookupFun('main')!

  // Env gốc mang jobId của root, để runBlocking/launch ở tầng ngoài cùng
  // gắn vào đúng cây thay vì tạo ra một root thứ hai.
  scheduler.spawnRoot(rootJob => (function* (): CoroutineBody {
    yield* interp.callFun(main, [], interp.globals.child(rootJob.id))
  })())
  scheduler.runToCompletion()

  const events = scheduler.emitter.events
  return {
    diagnostics: [],
    events,
    output: events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text),
  }
}
```

- [ ] **Step 7: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/interpreter-core.test.ts`
Expected: PASS — 10 test.

- [ ] **Step 8: Chạy toàn bộ test + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: sạch.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(engine): interpreter lõi bằng generator"
```

---

### Task 16: Interpreter — coroutine builder và điểm suspend

**Files:**
- Modify: `src/engine/interpreter/interpreter.ts`
- Test: `tests/engine/interpreter-coroutines.test.ts`

**Interfaces:**
- Consumes: `Interpreter.evalCall` (15), `Scheduler.spawn` (14), `CoroutineContext` (10)
- Produces: `evalCall` xử lý `runBlocking`, `launch`, `async`, `coroutineScope`, `supervisorScope`, `delay`, `yield`, `join`, `await`, `cancel`, `CoroutineScope`, `SupervisorJob`, `Job`, `Dispatchers.*`, `CoroutineName`

- [ ] **Step 1: Viết test thất bại**

`tests/engine/interpreter-coroutines.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string) => runSource(src).output
const evs = (src: string) => runSource(src).events

describe('interpreter — coroutine builder', () => {
  it('runBlocking chạy thân', () => {
    expect(out('fun main() = runBlocking {\n  println("in")\n}')).toEqual(['in'])
  })

  it('launch tạo child job', () => {
    const e = evs('fun main() = runBlocking {\n  launch { println("child") }\n}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    expect(created).toHaveLength(2)
    expect(created[1]).toMatchObject({ builder: 'launch', parentId: created[0]!.id })
  })

  it('launch chạy sau khi thân cha nhường quyền', () => {
    expect(out('fun main() = runBlocking {\n  launch { println("B") }\n  println("A")\n}'))
      .toEqual(['A', 'B'])
  })

  it('delay sắp xếp thứ tự hoàn thành', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  launch { delay(200); println("cham") }\n' +
      '  launch { delay(100); println("nhanh") }\n' +
      '}')).toEqual(['nhanh', 'cham'])
  })

  it('coroutineScope chờ hết children', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  coroutineScope { launch { delay(50); println("con") } }\n' +
      '  println("sau")\n' +
      '}')).toEqual(['con', 'sau'])
  })

  it('supervisorScope tạo job có isSupervisor', () => {
    const e = evs('fun main() = runBlocking {\n  supervisorScope { launch { } }\n}')
    expect(e.some(x => x.k === 'COROUTINE_CREATED' && x.ctx.isSupervisor)).toBe(true)
  })

  it('Dispatchers.IO đặt dispatcher cho coroutine', () => {
    const e = evs('fun main() = runBlocking {\n  launch(Dispatchers.IO) { delay(1) }\n}')
    expect(e.some(x => x.k === 'COROUTINE_CREATED' && x.ctx.dispatcher === 'IO')).toBe(true)
  })

  it('exception chưa bắt trong launch làm child FAILED', () => {
    const e = evs('fun main() = runBlocking {\n  launch { throw RuntimeException("boom") }\n}')
    expect(e.some(x => x.k === 'EXCEPTION_THROWN' && x.exType === 'RuntimeException')).toBe(true)
  })

  it('cancel job phát CANCEL_REQUESTED', () => {
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(1000) }\n' +
      '  j.cancel()\n' +
      '}')
    expect(e.some(x => x.k === 'CANCEL_REQUESTED')).toBe(true)
  })

  it('finally vẫn chạy khi coroutine bị cancel — kiểm chứng chọn generator là đúng', () => {
    const o = out(
      'fun main() = runBlocking {\n' +
      '  try { delay(10); println("xong") } finally { println("dontrolai") }\n' +
      '}')
    expect(o).toContain('dontrolai')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run tests/engine/interpreter-coroutines.test.ts`
Expected: FAIL — `launch` chưa được nhận diện, không có COROUTINE_CREATED thứ hai.

- [ ] **Step 3: Thêm nhận diện builder vào `evalCall`**

Chèn vào đầu `evalCall`, **trước** nhánh `println`:

```ts
    const calleeName = e.callee.k === 'Ident'
      ? e.callee.name
      : e.callee.k === 'Member' ? e.callee.name : null

    // ---- điểm suspend ----
    if (calleeName === 'delay') {
      const ms = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : { t: 'num' as const, v: 0 }
      yield { s: 'delay', ms: ms.t === 'num' ? ms.v : 0 }
      return UNIT
    }
    if (calleeName === 'yield') { yield { s: 'yield' }; return UNIT }

    if (calleeName === 'join' || calleeName === 'await') {
      const target = e.callee.k === 'Member' ? yield* this.evalExpr(e.callee.target, env) : UNIT
      const jobId = target.t === 'obj' ? target.fields.get('__jobId') : undefined
      if (jobId && jobId.t === 'str') yield { s: calleeName === 'join' ? 'join' : 'await', jobId: jobId.v }
      return UNIT
    }

    if (calleeName === 'cancel' || calleeName === 'cancelAndJoin') {
      const target = e.callee.k === 'Member' ? yield* this.evalExpr(e.callee.target, env) : UNIT
      const jobId = target.t === 'obj' ? target.fields.get('__jobId') : undefined
      if (jobId && jobId.t === 'str') {
        this.scheduler.cancelById(jobId.v, {
          exType: 'CancellationException', message: 'Job was cancelled', isCancellation: true,
        })
      }
      return UNIT
    }

    // ---- coroutine builder ----
    if (calleeName === 'runBlocking' || calleeName === 'coroutineScope'
        || calleeName === 'supervisorScope' || calleeName === 'withContext') {
      const lambda = e.lambda
      if (!lambda) return UNIT
      const isSupervisor = calleeName === 'supervisorScope'
      const ctx = yield* this.contextFromArgs(e, env)
      const job = this.scheduler.spawnInline(
        calleeName === 'runBlocking' ? 'runBlocking'
          : calleeName === 'withContext' ? 'withContext'
          : calleeName === 'coroutineScope' ? 'coroutineScope' : 'supervisorScope',
        env.enclosingJobId, isSupervisor, ctx,
      )
      try {
        // Thân scope chạy trong Env mang jobId của scope, nên launch bên trong
        // gắn đúng cha kể cả sau khi suspend/resume.
        const result = yield* this.evalBlock(lambda.body, env.child(job.id))
        // coroutineScope/supervisorScope/runBlocking chỉ trả về khi mọi child xong.
        yield { s: 'joinChildren', jobId: job.id }
        return result
      } finally {
        this.scheduler.completeInline(job)
      }
    }

    if (calleeName === 'launch' || calleeName === 'async') {
      const lambda = e.lambda
      if (!lambda) return UNIT
      const ctx = yield* this.contextFromArgs(e, env)
      const body = lambda.body
      const self = this
      // Factory nhận Job vừa tạo, nên Env con mang đúng jobId của chính coroutine này.
      const job = this.scheduler.spawnChildOf(env.enclosingJobId, ctx, calleeName, created =>
        (function* (): CoroutineBody { yield* self.evalBlock(body, env.child(created.id)) })())
      return {
        t: 'obj', className: calleeName === 'launch' ? 'Job' : 'Deferred',
        fields: new Map([['__jobId', { t: 'str', v: job.id } as KValue]]),
      }
    }

    // ---- factory context ----
    if (calleeName === 'SupervisorJob' || calleeName === 'Job') {
      return {
        t: 'obj', className: calleeName,
        fields: new Map([['__supervisor', { t: 'bool', v: calleeName === 'SupervisorJob' } as KValue]]),
      }
    }
    if (calleeName === 'CoroutineScope' || calleeName === 'MainScope') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return { t: 'obj', className: 'CoroutineScope', fields: new Map([['__ctx', arg]]) }
    }
    if (calleeName === 'CoroutineName') {
      const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
      return { t: 'obj', className: 'CoroutineName', fields: new Map([['name', arg]]) }
    }
```

- [ ] **Step 4: Thêm `contextFromArgs` vào `Interpreter`**

```ts
  /**
   * Dựng CoroutineContext từ đối số của builder.
   * Nhận Dispatchers.X, CoroutineName(...), SupervisorJob(), và chuỗi cộng bằng '+'.
   */
  protected *contextFromArgs(e: Expr & { k: 'Call' }, env: Env): Eval<CoroutineContext> {
    let ctx = CoroutineContext.empty()
    for (const a of e.args) {
      const v = yield* this.evalExpr(a.value, env)
      ctx = this.applyCtxValue(ctx, v)
    }
    return ctx
  }

  protected applyCtxValue(ctx: CoroutineContext, v: KValue): CoroutineContext {
    if (v.t !== 'obj') return ctx
    if (v.className.startsWith('Dispatchers.')) {
      return ctx.withDispatcher(v.className.slice('Dispatchers.'.length))
    }
    if (v.className === 'CoroutineName') {
      const n = v.fields.get('name')
      return n && n.t === 'str' ? ctx.withName(n.v) : ctx
    }
    if (v.className === 'CoroutineExceptionHandler') return ctx.withHandler('CEH')
    return ctx
  }
```

Bổ sung import: `CoroutineContext` từ `../runtime/context`.

Cho toán tử `+` trên object context: trong `evalBinary`, thêm ngay trước nhánh `l.t === 'num'`:
```ts
    if (e.op === '+' && l.t === 'obj' && r.t === 'obj') {
      const merged = new Map(l.fields)
      r.fields.forEach((val, key) => merged.set(key, val))
      return { t: 'obj', className: `${l.className}+${r.className}`, fields: merged }
    }
```

- [ ] **Step 5: Thêm API còn thiếu vào `Scheduler`**

```ts
  /**
   * launch/async: tạo child dưới `parentJobId` (lấy từ Env, KHÔNG lấy từ
   * currentJob — xem ghi chú trong Env), chạy sau, xếp cuối hàng ready.
   */
  spawnChildOf(
    parentJobId: JobId | null,
    ctx: CoroutineContext,
    builder: 'launch' | 'async',
    makeBody: (job: Job) => CoroutineBody,
  ): Job {
    const parent = this.jobById(parentJobId)
    const parentCtx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    return this.spawn(parent, false, builder, parentCtx.plus(ctx), makeBody)
  }

  /**
   * coroutineScope/supervisorScope/runBlocking/withContext: tạo Job trong cây
   * nhưng thân chạy ngay tại chỗ, không xếp hàng riêng.
   */
  spawnInline(
    builder: 'runBlocking' | 'coroutineScope' | 'supervisorScope' | 'withContext',
    parentJobId: JobId | null,
    isSupervisor: boolean,
    ctx: CoroutineContext,
  ): Job {
    const parent = this.jobById(parentJobId)
    const parentCtx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    const merged = parentCtx.plus(ctx)
    const id = this.newJobId()
    const job = new Job(id, merged.name ?? id, parent, isSupervisor)
    parent?.addChild(job)
    const jobCtx = merged.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
    })
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })
    this.tasks.set(id, {
      job, ctx: jobCtx, body: (function* (): CoroutineBody { })(), resumeValue: undefined, started: true,
    })
    return job
  }

  completeInline(job: Job): void {
    if (job.isCompleted) return
    job.transitionTo('Completing')
    this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Active', to: 'Completing' })
    job.transitionTo('Completed')
    this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Completing', to: 'Completed' })
  }

  cancelById(jobId: JobId, cause: FailureCause): void {
    const task = this.tasks.get(jobId)
    if (task) cancelJob(task.job, cause, this.emitter, 'user')
  }
```

Đổi `private nextJobId`/`newJobId`/`currentJob`/`tasks` thành `protected` nếu TypeScript báo lỗi truy cập.

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `npx vitest run tests/engine/interpreter-coroutines.test.ts`
Expected: PASS — 10 test.

Nếu test "launch chạy sau khi thân cha nhường quyền" fail (ra `['B','A']`): `spawnChildOf` phải **xếp task vào cuối `ready`**, không chạy ngay.

Nếu "coroutineScope chờ hết children" fail: kiểm tra `yield { s: 'joinChildren', jobId: job.id }` có nằm **sau** `evalBlock` và **trước** `completeInline` không. Tuyệt đối không thay bằng vòng lặp `while (...) yield { s: 'yield' }` — cách đó khiến `ready` không bao giờ rỗng, đồng hồ ảo không nhảy, và toàn bộ chương trình đứng hình cho tới khi guard 100k ném lỗi.

Nếu `launch` bên trong `coroutineScope` gắn nhầm cha (thấy `parentId` trỏ ra ngoài scope): thân scope phải chạy với `env.child(job.id)`, và `spawnChildOf` phải lấy cha từ `env.enclosingJobId` chứ không phải `this.currentJob`.

- [ ] **Step 7: Chạy toàn bộ test**

Run: `npm test && npm run typecheck`
Expected: sạch.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(engine): coroutine builder và điểm suspend"
```

---

### Task 17: Ba lesson đầu + golden trace

**Files:**
- Create: `src/lessons/jobtree/main.kt`, `src/lessons/jobtree/meta.json`
- Create: `src/lessons/normalfail/main.kt`, `src/lessons/normalfail/meta.json`
- Create: `src/lessons/supervisor/main.kt`, `src/lessons/supervisor/meta.json`
- Create: `src/lessons/index.ts`
- Modify: `src/engine/run.ts`
- Test: `tests/lessons/golden.test.ts`

**Interfaces:**
- Consumes: `runSource` (15), `foldTrace` (8)
- Produces: `LessonMeta`, `LESSONS: LessonMeta[]`, `loadLessonSource(id)`. Đây là mốc nghiệm thu của M1.

- [ ] **Step 1: Viết ba file `.kt`**

`src/lessons/jobtree/main.kt`:
```kotlin
fun main() = runBlocking {
    val parent = launch {
        launch { delay(1000) }
        launch { delay(1000) }
        launch { delay(1000) }
    }
    delay(50)
    parent.cancel()
}
```

`src/lessons/normalfail/main.kt`:
```kotlin
fun main() = runBlocking {
    coroutineScope {
        launch { delay(500); println("A xong") }
        launch { delay(100); throw RuntimeException("boom") }
        launch { delay(500); println("C xong") }
    }
}
```

`src/lessons/supervisor/main.kt`:
```kotlin
fun main() = runBlocking {
    supervisorScope {
        launch { delay(500); println("A xong") }
        launch { delay(100); throw RuntimeException("boom") }
        launch { delay(500); println("C xong") }
    }
}
```

`src/lessons/jobtree/meta.json`:
```json
{
  "id": "jobtree",
  "order": 1,
  "title": "Job Tree — parent cancel kéo theo children",
  "summary": "Structured concurrency: cancellation đi xuống toàn bộ cây."
}
```

`src/lessons/normalfail/meta.json`:
```json
{
  "id": "normalfail",
  "order": 2,
  "title": "Normal Job — child fail kéo sibling xuống",
  "summary": "Failure đi lên parent thường, rồi cancellation quay xuống sibling."
}
```

`src/lessons/supervisor/meta.json`:
```json
{
  "id": "supervisor",
  "order": 3,
  "title": "SupervisorJob — firewall cho child failure",
  "summary": "Supervisor chặn failure của direct child; sibling sống tiếp."
}
```

- [ ] **Step 2: Viết `src/lessons/index.ts`**

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LessonMeta { id: string; order: number; title: string; summary: string }

const here = dirname(fileURLToPath(import.meta.url))

export const LESSON_IDS = ['jobtree', 'normalfail', 'supervisor'] as const

export const LESSONS: LessonMeta[] = LESSON_IDS
  .map(id => JSON.parse(readFileSync(join(here, id, 'meta.json'), 'utf8')) as LessonMeta)
  .sort((a, b) => a.order - b.order)

export function loadLessonSource(id: string): string {
  return readFileSync(join(here, id, 'main.kt'), 'utf8')
}
```

- [ ] **Step 3: Viết test golden thất bại**

`tests/lessons/golden.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

const runLesson = (id: string) => runSource(loadLessonSource(id))
const finalWorld = (id: string) => {
  const r = runLesson(id)
  return foldTrace(r.events, r.events.length)
}

describe('lesson — nghiệm thu M1', () => {
  it('cả ba lesson parse và validate sạch', () => {
    for (const l of LESSONS) {
      expect(runLesson(l.id).diagnostics, `lesson ${l.id}`).toEqual([])
    }
  })

  it('LESSONS xếp theo order', () => {
    expect(LESSONS.map(l => l.id)).toEqual(['jobtree', 'normalfail', 'supervisor'])
  })

  describe('jobtree — cancel đi xuống', () => {
    it('mọi job đều kết thúc, không còn Active', () => {
      const w = finalWorld('jobtree')
      expect([...w.jobs.values()].filter(j => j.state === 'Active')).toEqual([])
    })

    it('có ít nhất 3 CANCEL_REQUESTED xuống các child', () => {
      const e = runLesson('jobtree').events.filter(x => x.k === 'CANCEL_REQUESTED')
      expect(e.length).toBeGreaterThanOrEqual(3)
    })

    it('không job nào in ra gì — bị cancel trước khi delay xong', () => {
      expect(runLesson('jobtree').output).toEqual([])
    })
  })

  describe('normalfail — failure kéo sibling xuống', () => {
    it('phát FAILURE_PROPAGATED không bị supervisor chặn', () => {
      const e = runLesson('normalfail').events
        .filter(x => x.k === 'FAILURE_PROPAGATED')
      expect(e.length).toBeGreaterThan(0)
      expect(e.every(x => x.blockedBySupervisor === false)).toBe(true)
    })

    it('A và C KHÔNG in ra — bị cancel theo', () => {
      expect(runLesson('normalfail').output).toEqual([])
    })

    it('có EXCEPTION_THROWN kiểu RuntimeException', () => {
      expect(runLesson('normalfail').events
        .some(x => x.k === 'EXCEPTION_THROWN' && x.exType === 'RuntimeException')).toBe(true)
    })
  })

  describe('supervisor — sibling sống tiếp', () => {
    it('phát FAILURE_PROPAGATED bị supervisor chặn', () => {
      expect(runLesson('supervisor').events
        .some(x => x.k === 'FAILURE_PROPAGATED' && x.blockedBySupervisor === true)).toBe(true)
    })

    it('A và C VẪN in ra — đây là khác biệt cốt lõi với normalfail', () => {
      expect(runLesson('supervisor').output).toEqual(['A xong', 'C xong'])
    })
  })

  it('cùng source cho trace y hệt qua nhiều lần chạy — deterministic', () => {
    for (const l of LESSONS) {
      const a = JSON.stringify(runLesson(l.id).events)
      const b = JSON.stringify(runLesson(l.id).events)
      expect(a, `lesson ${l.id}`).toBe(b)
    }
  })

  it('fold tại mọi step không ném lỗi', () => {
    for (const l of LESSONS) {
      const evts = runLesson(l.id).events
      for (let n = 0; n <= evts.length; n++) {
        expect(() => foldTrace(evts, n)).not.toThrow()
      }
    }
  })
})
```

- [ ] **Step 4: Chạy test, xác nhận fail**

Run: `npx vitest run tests/lessons/golden.test.ts`
Expected: FAIL — thiếu module `src/lessons`, và các assertion ngữ nghĩa chưa đúng.

- [ ] **Step 5: Sửa engine cho tới khi mọi assertion xanh**

Đây là bước tích hợp — sửa lỗi thật lộ ra ở đây, không sửa test cho khớp bug. Điểm hay hỏng, theo thứ tự nên kiểm tra:

1. **`supervisor` in ra rỗng** → `supervisorScope` chưa đặt `isSupervisor` cho Job của chính nó, nên `reportFailure` không thấy boundary. Kiểm tra `spawnInline(..., isSupervisor=true, ...)`.
2. **`normalfail` vẫn in "A xong"** → `cancelJob` chưa thực sự chặn task đang chờ timer. Trong `Scheduler.step`, kiểm tra `if (job.isCompleted) return` ở đầu — task bị cancel khi đang chờ timer vẫn nằm trong `ready`, phải bỏ qua khi tới lượt.
3. **`jobtree` in ra thứ gì đó** → `parent.cancel()` chưa lan xuống cháu. Kiểm tra `cancelById` gọi `cancelJob` (đệ quy), không phải chỉ đổi state một job.
4. **Trace không deterministic** → có chỗ duyệt `Map`/`Set` theo thứ tự không xác định, hoặc `Date.now`. Tìm và thay bằng mảng.

- [ ] **Step 6: Chạy toàn bộ test + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: toàn bộ xanh. Đây là mốc nghiệm thu M1.

- [ ] **Step 7: Viết `README.md` ngắn**

```markdown
# Kotlin Coroutines Lab

Công cụ học kotlinx.coroutines: viết code Kotlin, xem luồng chạy dưới dạng graph.

**Trạng thái: M1 — engine, chưa có UI.**

Engine biến source Kotlin (subset) thành `Event[]`; `foldTrace(events, n)` dựng lại
trạng thái tại bất kỳ step nào, nên tua ngược được.

    npm install
    npm test

Thiết kế: `docs/superpowers/specs/2026-08-11-kotlin-coroutines-lab-design.md`
Kế hoạch: `docs/superpowers/plans/2026-08-11-m1-engine-core.md`

Mô phỏng deterministic — Kotlin thật có thể interleave khác.
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(lessons): ba lesson đầu + golden test — hoàn thành M1"
```

---

## Nghiệm thu M1

- [ ] `npm test` xanh toàn bộ.
- [ ] `npm run typecheck` và `npm run lint` sạch.
- [ ] Ba lesson `jobtree` / `normalfail` / `supervisor` chạy đúng ngữ nghĩa, khác biệt supervisor vs normal Job hiện rõ trong output.
- [ ] Cùng source luôn cho trace y hệt.
- [ ] `foldTrace` chạy được ở mọi step mà không ném lỗi.
- [ ] Không file nào trong `src/engine/` import React hay chạm DOM.
