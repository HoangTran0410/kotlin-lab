# M3 — Đủ 9 lesson + diễn giải: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa cả 9 kịch bản dạy học của bản HTML gốc thành lesson Kotlin thật chạy qua simulator, có golden trace neo tính đúng, và có diễn giải tiếng Việt sinh tự động cho mọi bước — kể cả code do user tự viết.

**Architecture:** Ba lớp, làm theo đúng thứ tự đó. (1) Vá ngữ nghĩa engine đang SAI ÂM THẦM hoặc còn thiếu, vì không lesson nào dạy đúng được trên một engine nói dối. (2) Chuyển 9 kịch bản thành `src/lessons/<id>/` gồm `main.kt` + `meta.json` + `mental-model.md` + `expected-trace.json` + `expected-jvm-output.txt`, neo bằng golden test và bằng output JVM thật. (3) Thêm `src/engine/narrate/` — hàm thuần `Event × WorldState -> câu tiếng Việt` — rồi nối vào UI thành panel Narration, cùng LessonNav đầy đủ và DiagnosticsPanel phân loại nguồn lỗi.

**Tech Stack:** TypeScript 5, Vite 5, React 19, vitest 2.1, Zustand, React Flow (`@xyflow/react` 12), elkjs, CodeMirror 6. Không thêm dependency mới nào trong M3.

## Global Constraints

Mọi task đều chịu những ràng buộc dưới đây. Chúng lặp lại các ràng buộc đã có từ M1/M2 — vì chúng vẫn còn hiệu lực, không phải vì chúng mới.

- **`src/engine/**` là TypeScript thuần.** Cấm import React, Zustand, DOM, `node:fs`. Cấm `Math.random`, `Date.now`, `setTimeout`. ESLint ép cả hai chiều (`eslint.config.js`) — chạy `npm run lint` sẽ bắt được.
- **`src/ui/**` cấm import `node:fs` và cấm import `src/lessons/index.ts`** (file đó dùng `node:fs`, chỉ dành cho test chạy ở Node). UI đọc lesson qua `src/lessons/registry.ts`.
- **Engine phải deterministic.** Cùng source vào → cùng `Event[]` ra, từng byte. Dùng mảng thay cho `Set`/`Map` ở những chỗ thứ tự có ý nghĩa khi sinh trace.
- **Không được sai âm thầm.** Construct nằm ngoài subset §4.1 của spec phải cho ra `Diagnostic` đúng dòng/cột kèm `hint`. Trả `Unit` im lặng, hay trả object rác luôn-truthy, là LỖI — nặng hơn cả việc chưa hỗ trợ. Đây là ràng buộc §12 của spec và là lý do tồn tại của validator.
- **Ngôn ngữ:** mọi văn bản hướng tới người học (diagnostic, hint, narration, meta, mental model, comment trong code) viết bằng tiếng Việt. Tên định danh trong code viết bằng tiếng Anh.
- **Ngữ nghĩa neo vào Kotlin thật, không neo vào kỳ vọng của plan này.** Nếu một test trong plan mâu thuẫn với hành vi Kotlin thật, thì TEST SAI. Báo lại mâu thuẫn kèm bằng chứng thay vì bẻ code cho khớp test. Cách kiểm chứng chuẩn: chạy đoạn Kotlin đó trên `https://api.kotlinlang.org/api/2.1.20/compiler/run` (xem Task 13 để biết cách gọi).
- **Test phải chứng minh được là nó có canh gác.** Trước khi báo DONE, với mỗi test mới: cố ý phá phần code mà test đó nhắm tới, chạy lại, xác nhận nó ĐỎ, rồi khôi phục. Test xanh không chứng minh test có giá trị — trong M1/M2 đã có 8 lần test xanh trong khi thứ nó tuyên bố canh gác hoàn toàn không được canh. Báo cáo phải ghi rõ đã phá cái gì và test nào đỏ.
- **Không sửa golden fixture để test xanh.** `expected-trace.json` thay đổi CHỈ khi engine đổi có chủ đích, và khi đó phải regenerate bằng `npm run golden:update` rồi ghi trong báo cáo là trace thay đổi ở đâu và vì sao.
- **Commit bằng đường dẫn tường minh.** `git add <đường dẫn cụ thể>`, không bao giờ `git add -A` — có thể có công việc khác chưa commit trong cây làm việc.
- **Trước khi báo DONE phải chạy đủ bốn lệnh và cả bốn phải sạch:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Cảnh báo trong output test cũng là lỗi cần xử lý.

## Tài liệu nền

- Spec: `docs/superpowers/specs/2026-08-11-kotlin-coroutines-lab-design.md` — §4.1 là hợp đồng subset Kotlin, §4.4 là schema Event, §4.5 là yêu cầu về narrate, §7 là cấu trúc lesson.
- Nội dung dạy học gốc: `docs/reference/legacy-scenarios.md` — trích nguyên văn 9 kịch bản của bản HTML cũ (title, sub, desc, concept, code, node, cạnh, và các bước diễn giải). Đây là NGUỒN nội dung cho lesson mới. Nhiệm vụ của M3 là bảo toàn tri thức trong đó, không phải viết lại từ đầu.

## File Structure

**Sửa — engine (Phần A):**

| File | Đổi gì |
|---|---|
| `src/engine/parser/parser.ts` | nhánh `when` nhận vế phải là biểu thức, không bắt buộc `{ }` |
| `src/engine/ast/nodes.ts` | `WhenBranch` mang `block` HOẶC `expr`; `WhenExpr.subject` được dùng thật |
| `src/engine/interpreter/interpreter.ts` | `when` so subject; `error()`; `await` trả giá trị + ném lại; `job.isActive/isCancelled/isCompleted`; `isActive` trần; `ensureActive()`; `CoroutineScope(ctx)` có Job gốc thật; `Thread.currentThread().name` |
| `src/engine/interpreter/values.ts` | không đổi cấu trúc; chỉ dùng lại |
| `src/engine/runtime/suspension.ts` | `CoroutineBody` trả `unknown` thay vì `void` |
| `src/engine/runtime/scheduler.ts` | lưu kết quả coroutine vào Job; resume `await` bằng giá trị hoặc bằng throw; `withContext` đi qua dispatcher thật; phát `DISPATCH` |
| `src/engine/runtime/job.ts` | thêm `result: unknown` |
| `src/engine/validator/diagnostics.ts` | gỡ `isActive`/`isCancelled`/`isCompleted`/`ensureActive` khỏi danh sách chưa hỗ trợ; thêm `children`, `Thread`, `currentThread`, `getCompleted` với hint đúng |

**Tạo — lesson (Phần B):**

```
src/lessons/<id>/
  main.kt                  # code Kotlin thật, chạy được trên cả simulator lẫn JVM
  meta.json                # id, order, title, summary, concepts[]
  mental-model.md          # phần giải thích viết tay, mức cả bài
  expected-trace.json      # golden trace do engine sinh
  expected-jvm-output.txt  # output thật từ Kotlin playground
```

`<id>` ∈ `suspend`, `jobtree`, `exception`, `normalfail`, `supervisor`, `launchasync`, `dispatcher`, `scopecompare`, `nestedtrap` — theo đúng thứ tự đó (`order` 1..9).

**Tạo — narrate & UI (Phần C, D):**

| File | Trách nhiệm |
|---|---|
| `src/engine/trace/label.ts` | `jobLabel(view)` — tên hiển thị của một job, dùng CHUNG cho graph và narration |
| `src/engine/narrate/narrate.ts` | `narrate(event, before): string \| null` — hàm thuần, một event một câu |
| `src/engine/narrate/narrateTrace.ts` | `narrateTrace(events): NarrationLine[]` — một lượt duyệt O(N) |
| `src/ui/narration/NarrationPanel.tsx` | Panel hiện câu của step hiện tại + lịch sử, bấm được để nhảy step |
| `src/ui/lessons/MentalModel.tsx` | Hiện `mental-model.md` của lesson đang mở |
| `src/state/progress.ts` | Đánh dấu lesson đã học, lưu `localStorage` |
| `scripts/update-golden.ts` | Sinh lại `expected-trace.json` cho mọi lesson |

---

### Task 1: `when` — so sánh subject, và nhánh không cần ngoặc

Hai lỗi độc lập trong cùng một construct. Lỗi ngữ nghĩa là lỗi im lặng nghiêm trọng nhất còn tồn tại trong engine: `when (x) { 1 -> ... }` luôn chọn nhánh ĐẦU TIÊN bất kể `x` bằng bao nhiêu, không hề báo lỗi. Đã đo: `x = 2` in `"one"`, `x = 99` cũng in `"one"`.

Nguyên nhân: `interpreter.ts:133-138` coi mỗi `b.cond` là một điều kiện boolean độc lập — đúng cho `when { a > b -> ... }` (không có subject) nhưng sai hoàn toàn cho `when (x) { 1 -> ... }`. `WhenExpr.subject` được parse ra, lưu vào AST, và không bao giờ được đọc. Vì mọi số đều truthy, nhánh đầu luôn thắng.

Lỗi thứ hai ở parser: `parser.ts:312-333` bắt vế phải mọi nhánh phải là block `{ }`, nên `1 -> println("one")` — dạng phổ biến nhất trong Kotlin thật — là lỗi parse.

**Files:**
- Modify: `src/engine/ast/nodes.ts` (kiểu `WhenBranch`)
- Modify: `src/engine/parser/parser.ts:312-333`
- Modify: `src/engine/interpreter/interpreter.ts:133-138`
- Test: `tests/engine/when.test.ts` (tạo mới)

**Interfaces:**
- Produces: `WhenBranch = { cond: Expr | null; block: Block | null; expr: Expr | null }` — `cond === null` nghĩa là nhánh `else`. Đúng một trong `block`/`expr` khác null.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/engine/when.test.ts`. Dùng `runSource` từ `src/engine/run.ts` như mọi test engine khác trong repo.

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string): string[] => runSource(src).output
const diags = (src: string): unknown[] => runSource(src).diagnostics

describe('when có subject — so sánh subject với giá trị nhánh', () => {
  it('chọn nhánh khớp giá trị, không phải nhánh đầu tiên', () => {
    const src = `fun main() = runBlocking {
    val x = 2
    when (x) {
        1 -> println("one")
        2 -> println("two")
        else -> println("other")
    }
}`
    expect(diags(src)).toEqual([])
    expect(out(src)).toEqual(['two'])
  })

  it('không nhánh nào khớp thì chạy else', () => {
    // Ca này là ca PHÁT HIỆN bug gốc: trước khi sửa, x=99 vẫn in "one".
    const src = `fun main() = runBlocking {
    val x = 99
    when (x) {
        1 -> println("one")
        2 -> println("two")
        else -> println("other")
    }
}`
    expect(out(src)).toEqual(['other'])
  })

  it('so sánh được cả chuỗi', () => {
    const src = `fun main() = runBlocking {
    val s = "b"
    when (s) {
        "a" -> println("A")
        "b" -> println("B")
        else -> println("Z")
    }
}`
    expect(out(src)).toEqual(['B'])
  })

  it('không có else và không nhánh nào khớp thì không in gì, không nổ', () => {
    const src = `fun main() = runBlocking {
    val x = 7
    when (x) {
        1 -> println("one")
    }
    println("sống sót")
}`
    expect(out(src)).toEqual(['sống sót'])
  })
})

describe('when không subject — mỗi nhánh là một điều kiện boolean', () => {
  it('giữ nguyên ngữ nghĩa cũ: chọn điều kiện đúng đầu tiên', () => {
    const src = `fun main() = runBlocking {
    val n = 5
    when {
        n > 10 -> println("lớn")
        n > 3 -> println("vừa")
        else -> println("nhỏ")
    }
}`
    expect(out(src)).toEqual(['vừa'])
  })
})

describe('when — vế phải là biểu thức, không bắt buộc ngoặc nhọn', () => {
  it('nhánh dạng biểu thức parse sạch và chạy đúng', () => {
    // Trước khi sửa: "Mong đợi LBRACE nhưng gặp 'println'".
    const src = `fun main() = runBlocking {
    val x = 2
    when (x) {
        1 -> println("one")
        2 -> println("two")
    }
}`
    expect(diags(src)).toEqual([])
    expect(out(src)).toEqual(['two'])
  })

  it('trộn nhánh block và nhánh biểu thức trong cùng một when', () => {
    const src = `fun main() = runBlocking {
    val x = 1
    when (x) {
        1 -> { println("một"); println("vẫn một") }
        2 -> println("hai")
        else -> println("khác")
    }
}`
    expect(out(src)).toEqual(['một', 'vẫn một'])
  })

  it('when dùng làm biểu thức gán được vào val', () => {
    const src = `fun main() = runBlocking {
    val x = 2
    val tên = when (x) {
        1 -> "một"
        2 -> "hai"
        else -> "khác"
    }
    println(tên)
}`
    expect(out(src)).toEqual(['hai'])
  })

  it('nhánh biểu thức có điểm suspend vẫn suspend đúng', () => {
    // Vế phải chạy bằng yield* chứ không phải gọi thường — nếu cài sai,
    // delay bên trong nhánh sẽ không nhường quyền và đồng hồ ảo không nhích.
    const src = `fun main() = runBlocking {
    val x = 1
    when (x) {
        1 -> delay(100)
        else -> println("không tới")
    }
    println("sau when")
}`
    const r = runSource(src)
    expect(r.output).toEqual(['sau when'])
    const cuối = r.events[r.events.length - 1]!
    expect(cuối.t).toBeGreaterThanOrEqual(100)
  })
})
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/when.test.ts`
Kỳ vọng: FAIL. Nhóm "có subject" đỏ vì in sai nhánh; nhóm "biểu thức" đỏ vì lỗi parse "Mong đợi LBRACE".

- [ ] **Step 3: Mở rộng AST**

Trong `src/engine/ast/nodes.ts`, đổi kiểu nhánh của `WhenExpr` để mang được cả hai dạng vế phải:

```ts
export interface WhenBranch {
  /** null = nhánh `else`. */
  cond: Expr | null
  /** Vế phải dạng `{ ... }`. Đúng một trong block/expr khác null. */
  block: Block | null
  /** Vế phải dạng biểu thức đơn: `1 -> println("one")`. */
  expr: Expr | null
}
```

Giữ nguyên `WhenExpr.subject: Expr | null`.

- [ ] **Step 4: Parser nhận cả hai dạng vế phải**

Trong `parser.ts:312-333`, sau khi ăn `->`: nếu token kế tiếp là `LBRACE` thì `block = this.parseBlock()`, ngược lại `expr = this.parseExpr()`. Nhánh `else` giữ nguyên cách nhận biết hiện có, chỉ đổi phần vế phải y hệt.

- [ ] **Step 5: Interpreter so sánh subject**

Trong `interpreter.ts:133-138`, thay vòng lặp hiện tại bằng:

```ts
case 'WhenExpr': {
  // Có subject: so BẰNG với giá trị từng nhánh. Không subject: mỗi nhánh là
  // một điều kiện boolean. Trước đây chỉ có đường thứ hai, nên `when (x)`
  // luôn chọn nhánh đầu — mọi số đều truthy.
  const subject = e.subject ? yield* this.evalExpr(e.subject, env) : null
  for (const b of e.branches) {
    let khớp: boolean
    if (b.cond === null) khớp = true                       // else
    else if (subject === null) khớp = truthy(yield* this.evalExpr(b.cond, env))
    else khớp = display(yield* this.evalExpr(b.cond, env)) === display(subject)
    if (!khớp) continue
    const scope = env.child()
    if (b.block) return yield* this.evalBlock(b.block, scope)
    if (b.expr) return yield* this.evalExpr(b.expr, scope)
    return UNIT
  }
  return UNIT
}
```

`display()` để so sánh là cùng quy ước đã dùng cho `==` ở `evalBinary` (`interpreter.ts:203`) — giữ hai chỗ nhất quán, chứ không nghĩ ra cách so sánh thứ hai.

- [ ] **Step 6: Chạy lại toàn bộ test engine**

Chạy: `npx vitest run tests/engine/`
Kỳ vọng: PASS toàn bộ, kể cả các test `when` đã có từ trước (nếu có test cũ khẳng định hành vi CŨ SAI, đó là test sai — sửa test và ghi rõ trong báo cáo).

- [ ] **Step 7: Red-check**

Lần lượt phá rồi khôi phục, xác nhận mỗi lần có test đỏ:
1. Bỏ so sánh subject (quay lại `truthy(...)` cho mọi nhánh) → ca `x = 99` phải đỏ.
2. Bắt buộc `LBRACE` trở lại → ca "nhánh biểu thức" phải đỏ.
3. Đổi `yield* this.evalExpr(b.expr, scope)` thành gọi không `yield*`... (nếu TypeScript không cho, thay bằng: đổi vế phải biểu thức thành `evalExpr` của một literal cố định) → ca "nhánh biểu thức có điểm suspend" phải đỏ.

Ghi trong báo cáo: phá gì, test nào đỏ.

- [ ] **Step 8: Commit**

```bash
git add src/engine/ast/nodes.ts src/engine/parser/parser.ts src/engine/interpreter/interpreter.ts tests/engine/when.test.ts
git commit -m "fix(engine): when so sánh subject, và nhận nhánh dạng biểu thức"
```

---

### Task 2: Không được sai âm thầm — `error()`, `job.children`, `Thread`

Ba construct hiện cho ra kết quả sai mà không báo gì. Đây là vi phạm trực tiếp ràng buộc "không được sai âm thầm" ở Global Constraints, và mỗi cái sai một kiểu khác nhau:

- `error("boom")` — Kotlin ném `IllegalStateException`. Engine trả `Unit` im lặng: đã đo `println("before"); error("boom"); println("after")` in ra CẢ HAI dòng. Cái này SỬA (cài thật), vì nó nằm trong subset dạy học và 3 kịch bản gốc dùng nó.
- `job.children` — trả về object rác `{className: "Job.children"}`, luôn truthy, in ra literal `"Job.children"`. Cái này CHẶN (đưa vào danh sách chưa hỗ trợ), vì `children` là `Sequence<Job>` và hỗ trợ nó kéo theo cả API sequence — ngoài phạm vi M3.
- `Thread.currentThread()` — trả `Unit`, `.name` cũng `Unit`, in ra `"kotlin.Unit"`. Cái này CHẶN ở task này; Task 7 sẽ cài thật sau khi có cầu nối thread ảo.

**Files:**
- Modify: `src/engine/interpreter/interpreter.ts` (nhánh `error` trong `evalCall`)
- Modify: `src/engine/validator/diagnostics.ts` (thêm khoá `children`, `Thread`, `currentThread`)
- Test: `tests/engine/silent-wrong.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `KotlinThrow(kotlinType, kotlinMessage, line)` từ `src/engine/interpreter/values.ts:17-26`.
- Produces: `error(msg)` ném `KotlinThrow('IllegalStateException', msg, line)`.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('error() — ném IllegalStateException, không phải no-op', () => {
  it('dừng luồng ngay tại chỗ gọi', () => {
    // Trước khi sửa: in CẢ "before" LẪN "after" — câu error() bị nuốt im lặng.
    const r = runSource(`fun main() = runBlocking {
    println("before")
    error("boom")
    println("after")
}`)
    expect(r.output).toEqual(['before'])
  })

  it('bắt được bằng try/catch và đọc được message', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        error("hỏng rồi")
    } catch (e: IllegalStateException) {
        println("bắt được: " + e.message)
    }
}`)
    expect(r.output).toEqual(['bắt được: hỏng rồi'])
  })

  it('phát EXCEPTION_THROWN đúng kiểu và làm job fail', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { error("từ con") }
}`)
    const ném = r.events.filter(e => e.k === 'EXCEPTION_THROWN')
    expect(ném).toHaveLength(1)
    expect(ném[0]).toMatchObject({ exType: 'IllegalStateException', message: 'từ con' })
    expect(r.events.some(e => e.k === 'FAILURE_PROPAGATED')).toBe(true)
  })

  it('mang đúng số dòng của câu error()', () => {
    const r = runSource(`fun main() = runBlocking {

    error("ở dòng ba")
}`)
    const ném = r.events.find(e => e.k === 'EXCEPTION_THROWN')!
    expect(ném.srcLine).toBe(3)
  })
})

describe('construct chưa hỗ trợ phải BÁO, không được trả giá trị rác', () => {
  const chỗBáo = (src: string) => runSource(src).diagnostics

  it('job.children bị chặn kèm dòng và hint', () => {
    // Trước khi sửa: in ra literal "Job.children" — một object luôn truthy,
    // nên `if (job.children.isEmpty())` sai theo cách không nhìn thấy được.
    const d = chỗBáo(`fun main() = runBlocking {
    val j = launch { delay(10) }
    println(j.children)
}`)
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(3)
    expect(d[0]!.message).toContain('children')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('Thread.currentThread() bị chặn', () => {
    // Trước khi sửa: in ra "kotlin.Unit".
    const d = chỗBáo(`fun main() = runBlocking {
    println(Thread.currentThread().name)
}`)
    expect(d.length).toBeGreaterThan(0)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.hint).toBeTruthy()
  })

  it('không có construct chưa hỗ trợ nào lọt qua mà im lặng trả Unit', () => {
    // Canh gác theo chiều DƯƠNG: mọi khoá trong danh sách chưa hỗ trợ, khi
    // xuất hiện trong source, đều phải sinh diagnostic. Test này sẽ đỏ nếu ai
    // đó thêm khoá vào danh sách mà validator không quét tới dạng cú pháp đó.
    const { UNSUPPORTED } = await import('../../src/engine/validator/diagnostics')
    for (const khoá of Object.keys(UNSUPPORTED)) {
      const d = chỗBáo(`fun main() = runBlocking {\n    println(${khoá})\n}`)
      expect(d.length, `khoá ${khoá} không sinh diagnostic nào`).toBeGreaterThan(0)
    }
  })
})
```

Lưu ý: ca cuối dùng `await import` nên `it` phải là `async`. Nếu `UNSUPPORTED` chưa được export từ `diagnostics.ts` thì export nó ra (nó là dữ liệu thuần, export an toàn).

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/silent-wrong.test.ts`
Kỳ vọng: FAIL — `error()` không ném; `j.children` và `Thread` không sinh diagnostic nào.

- [ ] **Step 3: Cài `error()`**

Trong `evalCall` của `interpreter.ts`, đặt nhánh này NGAY TRƯỚC nhánh `println` (tức trước dòng 240 hiện tại), để nó không rơi xuống các nhánh fallback phía dưới:

```ts
if (name === 'error') {
  const arg = e.args[0] ? yield* this.evalExpr(e.args[0].value, env) : UNIT
  // Kotlin: error(msg) = throw IllegalStateException(msg.toString()).
  throw new KotlinThrow('IllegalStateException', display(arg), e.pos.line)
}
```

- [ ] **Step 4: Chặn `children`, `Thread`, `currentThread`**

Trong `diagnostics.ts`, thêm vào `UNSUPPORTED`:

```ts
children: {
  message: "'children' chưa được hỗ trợ",
  hint: 'Cây job đã hiện sẵn trên đồ thị — nhìn đồ thị thay vì duyệt job.children.',
},
Thread: {
  message: "'Thread' chưa được hỗ trợ",
  hint: 'Thread ảo hiện trên đồ thị và trên timeline. Xem badge thread của node.',
},
currentThread: {
  message: "'currentThread' chưa được hỗ trợ",
  hint: 'Thread ảo hiện trên đồ thị và trên timeline. Xem badge thread của node.',
},
```

Giữ nguyên hình dạng entry của các khoá đang có trong file — đọc một entry hiện có rồi làm theo, đừng tự nghĩ ra cấu trúc mới.

- [ ] **Step 5: Chạy lại và kiểm tra hồi quy**

Chạy: `npx vitest run`
Kỳ vọng: toàn bộ PASS. Nếu có lesson/test cũ nào dùng `error()` với giả định no-op thì nó sẽ đỏ — đó là bug được phát hiện, sửa test đó và ghi vào báo cáo.

- [ ] **Step 6: Red-check**

1. Đổi `throw new KotlinThrow(...)` thành `return UNIT` → ca "dừng luồng ngay tại chỗ gọi" phải đỏ.
2. Đổi `e.pos.line` thành `undefined` → ca "mang đúng số dòng" phải đỏ.
3. Gỡ khoá `children` khỏi `UNSUPPORTED` → ca `job.children` phải đỏ.

- [ ] **Step 7: Commit**

```bash
git add src/engine/interpreter/interpreter.ts src/engine/validator/diagnostics.ts tests/engine/silent-wrong.test.ts
git commit -m "fix(engine): error() ném thật; children/Thread báo lỗi thay vì trả rác"
```

---

### Task 3: `Deferred` mang giá trị và mang failure

`async` hiện là `launch` đội lốt: `await()` luôn trả `Unit` và không bao giờ đọc failure của Deferred. Đã đo `async { 42 }` rồi `await()` in ra `"kotlin.Unit"`. Và ca quyết định — `supervisorScope { val d = async { throw ... }; d.await() }` — in `"no exception seen"`, trong khi Kotlin thật ném tại chính điểm `await()`. Việc `await` "có vẻ đúng" ở ca đơn giản là trùng hợp: thất bại lan lên cha, cha bị cancel, `unwindCancelled` ném vào generator đang tình cờ treo tại `await()`.

Đây là gap chặn cứng lesson `launchasync`, và nó không có đường vòng nào.

Cơ chế: `Task.resumeValue` đã tồn tại (`scheduler.ts:16`) và đã được truyền vào `body.next()` (dòng 280), nhưng chưa bao giờ được gán giá trị khác `undefined`. Thêm đường thứ hai cho việc resume-bằng-exception.

**Files:**
- Modify: `src/engine/runtime/suspension.ts` (kiểu `CoroutineBody`)
- Modify: `src/engine/runtime/job.ts` (thêm `result`)
- Modify: `src/engine/runtime/scheduler.ts` (lưu result, resume await bằng value/throw)
- Modify: `src/engine/interpreter/interpreter.ts` (thân `async` trả giá trị; `await` đọc giá trị)
- Test: `tests/engine/deferred.test.ts` (tạo mới)

**Interfaces:**
- Produces: `CoroutineBody = Generator<Suspension, unknown, unknown>`; `Job.result: unknown`; `Task.resumeThrow: unknown | undefined`.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('async trả giá trị', () => {
  it('await() trả đúng giá trị của biểu thức cuối', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { 42 }
    println(d.await())
}`)
    expect(r.output).toEqual(['42'])
  })

  it('await() trả giá trị sau khi thân async đã suspend', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(100); "xong" }
    println(d.await())
}`)
    expect(r.output).toEqual(['xong'])
  })

  it('hai Deferred độc lập trả đúng giá trị của mình, không lẫn nhau', () => {
    // Ca này bắt lỗi "resumeValue dùng chung": nếu giá trị được ghi vào một chỗ
    // toàn cục thay vì vào đúng task đang chờ, hai kết quả sẽ đổi chỗ hoặc
    // trùng nhau.
    const r = runSource(`fun main() = runBlocking {
    val a = async { delay(200); "A" }
    val b = async { delay(100); "B" }
    println(a.await())
    println(b.await())
}`)
    expect(r.output).toEqual(['A', 'B'])
  })

  it('await() vẫn CHỜ đúng thời điểm, không chỉ trả giá trị', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(300); 7 }
    println(d.await())
}`)
    const in7 = r.events.find(e => e.k === 'PRINTLN')!
    expect(in7.t).toBe(300)
  })
})

describe('async giữ failure trong Deferred, ném tại điểm await', () => {
  it('supervisorScope: await() ném dù supervisor chặn failure khỏi scope', () => {
    // Ca QUYẾT ĐỊNH. Trước khi sửa: in "không thấy exception".
    // Kotlin thật: supervisor chặn ảnh hưởng lên scope/sibling, KHÔNG chặn
    // việc đọc trực tiếp một Deferred đã fail.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("boom") }
        delay(50)
        try {
            d.await()
            println("không thấy exception")
        } catch (e: RuntimeException) {
            println("bắt được: " + e.message)
        }
        println("scope chạy tiếp")
    }
}`)
    expect(r.output).toEqual(['bắt được: boom', 'scope chạy tiếp'])
  })

  it('await() trên Deferred đã fail TỪ TRƯỚC vẫn ném (không phải chỉ khi đang treo)', () => {
    // Đường đi khác hẳn: lúc gọi await thì job đã settled, nên scheduler đẩy
    // thẳng vào ready thay vì cho vào waiters. Nếu chỉ cài nhánh waiters thì
    // ca này lọt.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("sớm") }
        delay(200)
        try { d.await(); println("lọt") } catch (e: RuntimeException) { println("bắt: " + e.message) }
    }
}`)
    expect(r.output).toEqual(['bắt: sớm'])
  })

  it('async fail VẪN lan lên cha theo cấu trúc, kể cả khi không ai await', () => {
    // Bảo vệ hành vi đang ĐÚNG khỏi bị task này làm hỏng: sửa await không được
    // biến async thành "failure chỉ tồn tại trong Deferred".
    const r = runSource(`fun main() = runBlocking {
    async { throw RuntimeException("boom") }
    delay(100)
    println("không nên tới đây")
}`)
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'FAILURE_PROPAGATED')).toBe(true)
  })

  it('join() KHÔNG ném — chỉ await() mới ném', () => {
    // Khác biệt này là nội dung bài học launchasync.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("boom") }
        d.join()
        println("join xong, không ném")
    }
}`)
    expect(r.output).toEqual(['join xong, không ném'])
  })
})
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/deferred.test.ts`
Kỳ vọng: FAIL ở hầu hết ca. Ghi lại output thực tế của ca "supervisorScope" — nó là ca quyết định.

- [ ] **Step 3: Cho generator mang giá trị trả về**

Trong `suspension.ts`, đổi `CoroutineBody`:

```ts
export type CoroutineBody = Generator<Suspension, unknown, unknown>
```

Trong `job.ts`, thêm trường cạnh `cause`/`failure` đang có:

```ts
/** Giá trị thân coroutine trả về. Chỉ có nghĩa với async/Deferred. */
result: unknown = undefined
```

- [ ] **Step 4: Scheduler lưu result và resume await đúng cách**

Trong `scheduler.ts`:

1. Thêm vào `interface Task` (cạnh `resumeValue`, dòng 16):
```ts
/** Khi khác undefined: lần resume tới phải NÉM vào generator thay vì next(). */
resumeThrow: unknown
```
Khởi tạo `resumeThrow: undefined` ở mọi chỗ dựng Task.

2. Ở chỗ gọi generator (dòng ~280), tách hai đường:
```ts
if (task.resumeThrow !== undefined) {
  const t = task.resumeThrow
  task.resumeThrow = undefined
  result = task.body.throw(t)
} else {
  result = task.body.next(task.resumeValue)
}
task.resumeValue = undefined
```
Đặt trong cùng khối `try` đang có, để đường `catch` xử lý exception thoát ra vẫn nguyên vẹn.

3. Ở nhánh `result.done` (dòng ~305), lưu kết quả trước khi chuyển trạng thái:
```ts
job.result = result.value
```

4. Thêm hàm dựng giá trị resume cho một waiter kiểu `await`, dùng ở CẢ HAI chỗ đánh thức: nhánh `isJobSettled` trong `suspend()` (dòng ~325) và trong `sweepWaiters()`. Hai chỗ này phải dùng chung một hàm — nếu lệch nhau thì "await ném hay không" sẽ phụ thuộc vào việc Deferred settled trước hay sau lúc gọi await, đúng cái bug mà test ca 2 canh.

```ts
/**
 * Đánh thức một task đang chờ `await` trên `targetId`.
 *
 * `join` và `await` khác nhau đúng ở đây: join chỉ chờ, await ĐỌC kết quả —
 * nên await phải ném lại failure của Deferred tại chính điểm await, kể cả khi
 * supervisor đã chặn failure đó không cho ảnh hưởng tới scope.
 */
private wakeAwaiter(task: Task, targetId: JobId): void {
  const target = this.jobs.get(targetId)
  const failure = target?.failure ?? null
  if (failure) task.resumeThrow = new KotlinThrow(failure.exType, failure.message)
  else task.resumeValue = target?.result
  this.ready.push(task)
}
```
Tên chính xác của map giữ job (`this.jobs`) và của getter failure phải đọc từ `scheduler.ts`/`job.ts` hiện tại rồi dùng đúng tên đó.

5. Trong `suspend()` case `'await'` và trong `sweepWaiters()`, khi target đã settled thì gọi `this.wakeAwaiter(task, s.jobId)` thay cho `this.ready.push(task)`. Case `'join'` KHÔNG đổi — join không ném.

- [ ] **Step 5: Interpreter — async trả giá trị, await đọc giá trị**

Trong `interpreter.ts`, thân generator của `async` (nhánh `launch`/`async` trong `tryBuilder`, dòng ~384-405) phải trả về giá trị của thân lambda:

```ts
const job = this.scheduler.spawnChildOf(parentJobId, ctx, calleeName, created =>
  (function* (): CoroutineBody {
    const v = yield* evalBlock(body, env.child(created.id))
    yield { s: 'joinChildren', jobId: created.id }
    // Trả về SAU joinChildren: giá trị đã có từ trước, nhưng Deferred chỉ được
    // coi là xong khi mọi con của nó cũng xong (structured concurrency).
    return v
  })(), e.pos.line)
```

Trong `trySuspensionPoint`, tách `await` khỏi `join`:

```ts
if (calleeName === 'join' || calleeName === 'await') {
  const target = e.callee.k === 'Member' ? yield* this.evalExpr(e.callee.target, env) : UNIT
  const jobId = target.t === 'obj' ? target.fields.get('__jobId') : undefined
  if (jobId && jobId.t === 'str') {
    const đưaVề = yield { s: calleeName === 'join' ? 'join' : 'await', jobId: jobId.v, line: e.pos.line }
    // Chỉ await mới đọc kết quả. Scheduler ném thẳng vào generator này nếu
    // Deferred đã fail, nên tới được dòng dưới nghĩa là nó thành công.
    if (calleeName === 'await') return isKValue(đưaVề) ? đưaVề : UNIT
  }
  return UNIT
}
```

Thêm một type guard nhỏ trong `values.ts` (kèm test riêng không cần thiết — nó được test gián tiếp qua các ca ở trên):

```ts
export function isKValue(v: unknown): v is KValue {
  return typeof v === 'object' && v !== null && 't' in v
}
```

Đồng thời kiểm tra `evalBlock` có trả về giá trị của câu lệnh cuối không. Nếu nó luôn trả `UNIT`, sửa để trả giá trị của `ExprStmt` cuối cùng — Kotlin lambda lấy biểu thức cuối làm giá trị trả về. Nếu phải sửa, thêm ca test:

```ts
it('lambda async lấy biểu thức cuối làm giá trị, kể cả khi trước đó có câu lệnh khác', () => {
  const r = runSource(`fun main() = runBlocking {
    val d = async { println("phụ"); 99 }
    println(d.await())
}`)
  expect(r.output).toEqual(['phụ', '99'])
})
```

- [ ] **Step 6: Chạy toàn bộ**

Chạy: `npx vitest run`
Kỳ vọng: toàn bộ PASS. Đổi kiểu `CoroutineBody` có thể làm `npm run typecheck` phàn nàn ở những chỗ khác — sửa cho sạch.

- [ ] **Step 7: Red-check**

1. Trong `wakeAwaiter`, bỏ nhánh `failure` (luôn `resumeValue`) → ca "supervisorScope" phải đỏ.
2. Chỉ gọi `wakeAwaiter` trong `sweepWaiters`, để nhánh `isJobSettled` dùng `ready.push` như cũ → ca "đã fail TỪ TRƯỚC" phải đỏ.
3. Trong `wakeAwaiter`, cho `join` cũng ném (bỏ điều kiện phân biệt ở chỗ gọi) → ca "join() KHÔNG ném" phải đỏ.
4. Bỏ `job.result = result.value` → ca "await() trả đúng giá trị" phải đỏ.

- [ ] **Step 8: Commit**

```bash
git add src/engine/runtime/suspension.ts src/engine/runtime/job.ts src/engine/runtime/scheduler.ts src/engine/interpreter/interpreter.ts src/engine/interpreter/values.ts tests/engine/deferred.test.ts
git commit -m "feat(engine): Deferred mang giá trị và ném failure tại điểm await"
```

---

### Task 4: Đọc trạng thái Job từ code Kotlin

`Job` đã có state thật (`job.ts:83-87`: `isActive`, `isCompleted`, `isCancelled`, `children` là getter đọc `_state`/`_children`), nhưng interpreter không bao giờ đọc tới — `Member` expr chỉ tra `target.fields` của một `KValue` object tự dựng. Ba thuộc tính này đang bị validator chặn, nên chúng báo lỗi rõ ràng thay vì sai âm thầm — đúng cách, nhưng chúng nằm trong subset §4.1 và là **lõi của lesson `suspend`**: bài học đó dạy "coroutine SUSPENDED nhưng Job vẫn ACTIVE", và cách duy nhất để thấy điều đó bằng code là `println(job.isActive)`.

Cùng lúc, `isActive` trần và `ensureActive()` trong thân coroutine là idiom chuẩn của vòng lặp huỷ được — cần cho lesson `suspend` phần "cooperative cancellation".

**Files:**
- Modify: `src/engine/interpreter/interpreter.ts` (nhánh `Member` và nhánh `Ident`; `ensureActive` trong `evalCall`)
- Modify: `src/engine/validator/diagnostics.ts` (gỡ 4 khoá)
- Test: `tests/engine/job-state.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `Scheduler.currentJob` và map job theo id (đọc tên thật trong `scheduler.ts`). Interpreter tra Job thật qua `__jobId` giống hệt cách `join`/`cancel` đang làm (`interpreter.ts:292-299`).
- Produces: interpreter tra được `Job` từ một `KValue` object mang `__jobId`; `isActive` trần đọc job của scope từ vựng (`env.enclosingJobId`), KHÔNG đọc `scheduler.currentJob` — `currentJob` bị reset mỗi `step()` nên nó sai ngay sau lần suspend đầu tiên.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('job.isActive / isCancelled / isCompleted đọc trạng thái THẬT', () => {
  it('coroutine đang SUSPENDED thì Job vẫn ACTIVE — lõi của lesson suspend', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        println("A")
        delay(1000)
        println("B")
    }
    delay(10)
    println("đang delay, isActive = " + job.isActive)
    job.join()
    println("xong, isActive = " + job.isActive)
}`)
    expect(r.output).toEqual([
      'A',
      'đang delay, isActive = true',
      'B',
      'xong, isActive = false',
    ])
  })

  it('sau khi cancel: isCancelled true, isActive false, isCompleted true', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(1000) }
    delay(10)
    job.cancelAndJoin()
    println(job.isActive)
    println(job.isCancelled)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true', 'true'])
  })

  it('job xong bình thường: isCancelled false nhưng isCompleted true', () => {
    // Phân biệt hai cái này chính là bài học. Nếu cài sai kiểu "isCompleted =
    // !isActive" thì ca trên vẫn xanh còn ca này đỏ.
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    job.join()
    println(job.isCancelled)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true'])
  })
})

describe('isActive trần và ensureActive() trong thân coroutine', () => {
  it('vòng lặp isActive dừng khi bị cancel', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        var i = 0
        while (isActive) {
            println("tick " + i)
            i = i + 1
            delay(100)
        }
        println("thoát vòng lặp")
    }
    delay(250)
    job.cancelAndJoin()
    println("đã huỷ")
}`)
    // t=0,100,200 in ba tick; t=250 cancel; vòng lặp không chạy tick thứ tư.
    expect(r.output.filter(l => l.startsWith('tick'))).toEqual(['tick 0', 'tick 1', 'tick 2'])
    expect(r.output[r.output.length - 1]).toBe('đã huỷ')
  })

  it('isActive trần đọc job của coroutine BAO QUANH THEO TỪ VỰNG, không phải job đang chạy', () => {
    // Nếu cài bằng scheduler.currentJob thì sau lần suspend đầu tiên giá trị
    // này trỏ nhầm job và ca trên có thể vẫn xanh trong khi ngữ nghĩa đã sai.
    const r = runSource(`fun main() = runBlocking {
    val ngoài = launch {
        delay(10)
        launch { delay(500) }
        println("trong launch ngoài: " + isActive)
    }
    ngoài.join()
}`)
    expect(r.output).toEqual(['trong launch ngoài: true'])
  })

  it('ensureActive() ném CancellationException khi job đã bị huỷ', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("bắt được huỷ")
        }
        ensureActive()
        println("không tới đây")
    }
    delay(10)
    job.cancelAndJoin()
    println("xong")
}`)
    expect(r.output).toEqual(['bắt được huỷ', 'xong'])
  })
})
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/job-state.test.ts`
Kỳ vọng: FAIL — hiện các thuộc tính này bị validator chặn nên `runSource` trả diagnostics và không có output.

- [ ] **Step 3: Gỡ khỏi danh sách chưa hỗ trợ**

Trong `diagnostics.ts`, xoá bốn khoá: `isActive`, `isCancelled`, `isCompleted`, `ensureActive`. Giữ nguyên `getCompleted` (vẫn chưa hỗ trợ).

- [ ] **Step 4: Interpreter đọc Job thật**

Thêm helper trong `interpreter.ts` (cạnh chỗ `trySuspensionPoint` đọc `__jobId`):

```ts
/** Job thật đằng sau một KValue object mang `__jobId`, hoặc null. */
private jobOf(v: KValue): Job | null {
  if (v.t !== 'obj') return null
  const id = v.fields.get('__jobId')
  return id && id.t === 'str' ? this.scheduler.jobById(id.v) : null
}
```

`Scheduler` cần một getter công khai `jobById(id: JobId): Job | null` nếu chưa có — đọc `scheduler.ts` để dùng đúng map đang giữ job.

Trong nhánh `case 'Member'` (`interpreter.ts:139-147`), TRƯỚC fallback tạo object rác:

```ts
const job = this.jobOf(target)
if (job) {
  if (e.name === 'isActive') return { t: 'bool', v: job.isActive }
  if (e.name === 'isCancelled') return { t: 'bool', v: job.isCancelled }
  if (e.name === 'isCompleted') return { t: 'bool', v: job.isCompleted }
}
```

Trong nhánh `case 'Ident'` (`interpreter.ts:110-113`), trước fallback: nếu tên là `isActive` và không có biến nào tên đó trong env, trả trạng thái của `env.enclosingJobId`:

```ts
if (e.name === 'isActive' && !env.has('isActive')) {
  const j = env.enclosingJobId === null ? null : this.scheduler.jobById(env.enclosingJobId)
  return { t: 'bool', v: j ? j.isActive : true }
}
```

Tên phương thức kiểm tra biến tồn tại (`env.has`) phải đọc từ `env.ts` và dùng đúng tên thật.

Trong `evalCall`, thêm `ensureActive` cạnh nhánh `error` của Task 2:

```ts
if (name === 'ensureActive') {
  const j = env.enclosingJobId === null ? null : this.scheduler.jobById(env.enclosingJobId)
  if (j && !j.isActive) {
    throw new KotlinThrow('CancellationException', 'Job was cancelled', e.pos.line)
  }
  return UNIT
}
```

- [ ] **Step 5: Chạy toàn bộ**

Chạy: `npx vitest run` rồi `npm run typecheck` và `npm run lint`.
Kỳ vọng: toàn bộ PASS. Nếu có test cũ khẳng định `isActive` PHẢI sinh diagnostic thì đó là test của trạng thái cũ — cập nhật nó và ghi vào báo cáo.

- [ ] **Step 6: Red-check**

1. Cho `isCompleted` trả `!job.isActive` → ca "job xong bình thường" vẫn xanh nhưng ca "sau khi cancel" đỏ? Kiểm tra thật; nếu KHÔNG ca nào đỏ thì bộ test chưa phân biệt được ba thuộc tính — bổ sung ca cho tới khi có ca đỏ, rồi ghi lại.
2. Cài `isActive` trần bằng `scheduler.currentJob` thay vì `env.enclosingJobId` → ca "đọc job bao quanh theo từ vựng" phải đỏ.
3. Cho `ensureActive` luôn trả `UNIT` → ca `ensureActive()` phải đỏ.

- [ ] **Step 7: Commit**

```bash
git add src/engine/interpreter/interpreter.ts src/engine/validator/diagnostics.ts src/engine/runtime/scheduler.ts tests/engine/job-state.test.ts
git commit -m "feat(engine): đọc isActive/isCancelled/isCompleted và ensureActive từ code Kotlin"
```

---

### Task 5: `CoroutineScope(ctx)` có Job gốc thật

Đã đo: `CoroutineScope(SupervisorJob())` hoạt động y hệt `GlobalScope` — không có Job nào đại diện cho scope trong cây, mọi `scope.launch` đều `parentId: null` và `isSupervisor: false`, cờ `SupervisorJob()` bị đánh rơi ngay ở bước dựng context (`applyCtxValue`, `interpreter.ts:508-528`, không có nhánh nào nhận `Job`/`SupervisorJob`).

Hậu quả: `scope.launch { throw }` làm exception biến mất không dấu vết, và `"B vẫn sống"` in ra KHÔNG PHẢI vì SupervisorJob cô lập được failure mà vì hai coroutine đó chẳng có quan hệ gì với nhau. Đúng thứ hiểu lầm mà công cụ này tồn tại để chữa.

`CoroutineScope(SupervisorJob() + Dispatchers.Main)` là pattern Android kinh điển và xuất hiện trong 3 kịch bản gốc (`supervisor`, `dispatcher`, `nestedtrap`). Nó phải đúng.

Đối chiếu Kotlin thật: `CoroutineScope(ctx)` tạo một scope mang Job GỐC (không cha). `scope.launch { }` là CON của Job đó. `GlobalScope` thì khác — context của nó rỗng, không có Job nào, nên con của `GlobalScope` thật sự không cha. Hai thứ này phải phân biệt được, và sự khác biệt đó chính là bài học.

**Files:**
- Modify: `src/engine/trace/events.ts` (thêm `'scope'` vào union `builder`)
- Modify: `src/engine/runtime/scheduler.ts` (`spawnScopeRoot`)
- Modify: `src/engine/interpreter/interpreter.ts` (`tryContextFactory`, `applyCtxValue`, `scopeReceiver`)
- Modify: `src/engine/runtime/context.ts` (mang cờ supervisor trong context)
- Modify: `src/ui/graph/nodeStyle.ts` (accent cho builder `'scope'`)
- Modify: `src/ui/theme/tokens.css` (token màu `--k-scope`)
- Test: `tests/engine/scope-root.test.ts` (tạo mới)

**Interfaces:**
- Produces: `Scheduler.spawnScopeRoot(ctx: CoroutineContext, isSupervisor: boolean): Job` — tạo Job không cha, builder `'scope'`, phát `COROUTINE_CREATED`. Job này KHÔNG có thân generator: nó chỉ tồn tại làm điểm neo cấu trúc, không bao giờ vào hàng ready, không bao giờ `Completed` bằng đường thường.
- Produces: giá trị `CoroutineScope` mang thêm field `__jobId` (id của scope root), nên `scopeReceiver` trả `parentJobId` là id đó.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('CoroutineScope(ctx) là một Job gốc thật', () => {
  it('scope.launch là CON của scope, không phải job mồ côi', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(10) }
    delay(100)
}`)
    const tạo = r.events.filter(e => e.k === 'COROUTINE_CREATED')
    const scope = tạo.find(e => e.builder === 'scope')!
    expect(scope).toBeDefined()
    expect(scope.parentId).toBeNull()
    expect(scope.ctx.isSupervisor).toBe(true)
    const con = tạo.find(e => e.builder === 'launch')!
    expect(con.parentId).toBe(scope.id)
  })

  it('SupervisorJob của scope CHẶN failure của con, sibling vẫn sống', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { throw RuntimeException("boom") }
    scope.launch { delay(300); println("B vẫn sống") }
    delay(500)
    println("main xong")
}`)
    expect(r.output).toEqual(['B vẫn sống', 'main xong'])
    // Phải có ranh giới supervisor THẬT trên trace, không phải "sống vì không
    // có quan hệ cha con nào".
    const chặn = r.events.filter(e => e.k === 'FAILURE_PROPAGATED' && e.blockedBySupervisor)
    expect(chặn.length).toBeGreaterThan(0)
  })

  it('Job() thường (không supervisor): một con fail kéo theo sibling bị huỷ', () => {
    // Cặp đối chứng của ca trên. Nếu cài kiểu "scope luôn là supervisor" thì
    // ca trên xanh còn ca này đỏ.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(Job())
    scope.launch { delay(50); throw RuntimeException("boom") }
    scope.launch { delay(300); println("B không nên in") }
    delay(500)
    println("main xong")
}`)
    expect(r.output).toEqual(['main xong'])
  })

  it('GlobalScope VẪN không cha — khác hẳn CoroutineScope', () => {
    // Bảo vệ sự khác biệt đang đúng. Nếu ai đó "thống nhất" hai đường này thì
    // bài học "GlobalScope thoát khỏi structured concurrency" biến mất.
    const r = runSource(`fun main() = runBlocking {
    GlobalScope.launch { delay(10) }
    delay(100)
}`)
    const tạo = r.events.filter(e => e.k === 'COROUTINE_CREATED')
    expect(tạo.some(e => e.builder === 'scope')).toBe(false)
    const con = tạo.find(e => e.builder === 'launch')!
    expect(con.parentId).toBeNull()
  })

  it('scope.cancel() huỷ mọi con', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(1000); println("A không nên in") }
    scope.launch { delay(1000); println("B không nên in") }
    delay(50)
    scope.cancel()
    delay(2000)
    println("xong")
}`)
    expect(r.output).toEqual(['xong'])
  })

  it('dispatcher trong context của scope truyền xuống con', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))
    scope.launch { delay(10) }
    delay(100)
}`)
    const con = r.events.filter(e => e.k === 'COROUTINE_CREATED').find(e => e.builder === 'launch')!
    expect(con.ctx.dispatcher).toBe('IO')
    expect(con.ctx.name).toBe('worker')
  })
})
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/scope-root.test.ts`
Kỳ vọng: FAIL — không có event nào có `builder === 'scope'`; ca "Job() thường" hiện đang in `'main xong'` một cách tình cờ nên đọc kỹ, nó có thể xanh nhầm.

- [ ] **Step 3: Mở rộng union builder**

Trong `src/engine/trace/events.ts`, thêm `'scope'` vào union `builder` của `COROUTINE_CREATED`. Trong `src/ui/graph/nodeStyle.ts`, thêm `scope: 'var(--k-scope)'` vào `BUILDER_ACCENT`, và khai `--k-scope` trong `src/ui/theme/tokens.css` (chọn màu trung tính, khác 6 màu đang có).

- [ ] **Step 4: Context mang cờ supervisor**

Trong `context.ts`, thêm `isSupervisor: boolean` (mặc định false) và `withSupervisor(v: boolean)` theo đúng kiểu các `with*` đang có. Trong `applyCtxValue` (`interpreter.ts`), thêm:

```ts
if (v.className === 'SupervisorJob') return ctx.withSupervisor(true)
if (v.className === 'Job') return ctx.withSupervisor(false)
```

- [ ] **Step 5: `spawnScopeRoot` trong Scheduler**

```ts
/**
 * Job GỐC đại diện cho một `CoroutineScope(ctx)`. Không cha, không thân
 * generator, không bao giờ vào hàng ready — nó chỉ là điểm neo cấu trúc để
 * `scope.launch` có cha thật và để SupervisorJob có chỗ mà chặn failure.
 *
 * Không tự Completed: trong Kotlin, scope do user tự dựng sống cho tới khi bị
 * cancel. Nó kết thúc khi `scope.cancel()` được gọi, hoặc không bao giờ.
 */
spawnScopeRoot(ctx: CoroutineContext, isSupervisor: boolean): Job
```

Cài theo đúng khuôn `spawnInline` đang có (`scheduler.ts:375`): dựng `Job`, đăng ký vào map job, phát `COROUTINE_CREATED` với `parentId: null`, `builder: 'scope'`, `ctx` tóm tắt như các builder khác, rồi `transitionTo('Active')` + phát `JOB_STATE`.

- [ ] **Step 6: `tryContextFactory` dựng scope root**

Trong nhánh `CoroutineScope`/`MainScope` của `tryContextFactory`:

```ts
const ctx = this.applyCtxValue(CoroutineContext.empty(), arg)
const root = this.scheduler.spawnScopeRoot(ctx, ctx.isSupervisor)
return {
  t: 'obj', className: 'CoroutineScope',
  fields: new Map<string, KValue>([
    ['__ctx', arg],
    ['__jobId', { t: 'str', v: root.id }],
  ]),
}
```

`__jobId` khiến `scope.cancel()` chạy đúng ngay lập tức: nhánh `cancel` trong `trySuspensionPoint` (`interpreter.ts:301-...`) đã tra `__jobId` sẵn rồi.

Trong `scopeReceiver`, nhánh `CoroutineScope` trả `parentJobId` là id đó thay vì `null`:

```ts
if (target.className === 'CoroutineScope') {
  const raw = target.fields.get('__ctx')
  const ctx = raw ? this.applyCtxValue(CoroutineContext.empty(), raw) : CoroutineContext.empty()
  const id = target.fields.get('__jobId')
  return { parentJobId: id && id.t === 'str' ? id.v : null, ctx }
}
```

Nhánh `GlobalScope` giữ nguyên `parentJobId: null` — đó là điểm khác biệt, không phải thiếu sót.

- [ ] **Step 7: Job gốc không giữ chương trình sống mãi**

Scope root là Active và không bao giờ tự xong. Kiểm tra `runToCompletion` (`scheduler.ts`) không rơi vào vòng lặp vô hạn vì nó: vòng lặp chỉ tiếp tục khi còn task ready hoặc còn timer, mà scope root không có task nào — nên nó dừng đúng. Chạy ca test "scope.launch là CON của scope" để xác nhận chương trình kết thúc; nếu nó treo tới guard 100.000 vòng thì báo lại chi tiết thay vì tự chữa bằng cách cho scope root tự Completed (làm vậy sẽ phá ngữ nghĩa "scope sống cho tới khi cancel").

- [ ] **Step 8: Chạy toàn bộ + red-check**

Chạy: `npx vitest run`, `npm run typecheck`, `npm run lint`, `npm run build`.

Red-check:
1. Cho `spawnScopeRoot` luôn `isSupervisor: false` → ca "SupervisorJob CHẶN failure" phải đỏ.
2. Cho `spawnScopeRoot` luôn `isSupervisor: true` → ca "Job() thường" phải đỏ.
3. Cho `scopeReceiver` nhánh `GlobalScope` cũng dựng scope root → ca "GlobalScope VẪN không cha" phải đỏ.

- [ ] **Step 9: Commit**

```bash
git add src/engine/trace/events.ts src/engine/runtime/scheduler.ts src/engine/runtime/context.ts src/engine/interpreter/interpreter.ts src/ui/graph/nodeStyle.ts src/ui/theme/tokens.css tests/engine/scope-root.test.ts
git commit -m "feat(engine): CoroutineScope(ctx) có Job gốc thật, giữ được cờ SupervisorJob"
```

---

### Task 6: `withContext` đổi thread thật, và println gắn đúng job

Hai lỗi cùng gốc: mọi builder chạy INLINE (`runBlocking`, `coroutineScope`, `supervisorScope`, `withContext`) chạy thân bằng `yield* evalBlock(...)` ngay trong generator của task cha, nên chúng không bao giờ đi qua `pool.acquire()`.

- **println gắn nhầm job.** `Scheduler.println` (`scheduler.ts:71-72`) dùng `this.currentJob`, mà `currentJob` được gán từ `task.job` ở đầu mỗi `step()` — tức job NGOÀI. Đã đo: `withContext(Dispatchers.IO) { println("trong IO") }` sinh `PRINTLN` mang `id` của job runBlocking. Điều này làm sai highlight trên đồ thị cho MỌI scope inline, không riêng `withContext`.
- **`withContext(Dispatchers.IO)` không đổi thread.** Đã đo: cả chương trình chỉ xuất hiện đúng một `threadId` là `Main-1`, không có `IO-1` nào được acquire. Đây là idiom phổ biến nhất để dạy "đổi dispatcher" và nó không hiện được gì trên trace.
- **Event `DISPATCH` chưa bao giờ được phát.** `foldTrace` đã có sẵn nhánh xử lý (`world.ts:71-75`) nhưng chết vì không ai emit.

**Files:**
- Modify: `src/engine/runtime/scheduler.ts` (ngăn xếp inline job; suspension `switchContext`; phát `DISPATCH`)
- Modify: `src/engine/runtime/suspension.ts` (thêm biến thể `switchContext`)
- Modify: `src/engine/interpreter/interpreter.ts` (nhánh `withContext` yield điểm đổi context)
- Test: `tests/engine/dispatch.test.ts` (tạo mới)

**Interfaces:**
- Produces: `Suspension` thêm `{ s: 'switchContext'; jobId: JobId; dispatcher: string; line?: number }`.
- Produces: `Scheduler` giữ `inlineStack: Job[]`; `currentJob` hiệu dụng = đỉnh ngăn xếp nếu có, ngược lại `task.job`.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const idCủaPrintln = (src: string, text: string): string => {
  const r = runSource(src)
  const e = r.events.find(x => x.k === 'PRINTLN' && x.text === text)
  if (!e || e.k !== 'PRINTLN') throw new Error(`không tìm thấy println "${text}"`)
  return e.id
}

describe('println gắn đúng job của scope inline bao quanh', () => {
  it('println trong withContext mang id của job withContext, không phải job ngoài', () => {
    const src = `fun main() = runBlocking {
    println("ngoài")
    withContext(Dispatchers.IO) { println("trong") }
}`
    const r = runSource(src)
    const wc = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'withContext')!
    expect(idCủaPrintln(src, 'trong')).toBe(wc.id)
    expect(idCủaPrintln(src, 'ngoài')).not.toBe(wc.id)
  })

  it('println trong coroutineScope mang id của coroutineScope', () => {
    const src = `fun main() = runBlocking {
    coroutineScope { println("trong scope") }
}`
    const r = runSource(src)
    const cs = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'coroutineScope')!
    expect(idCủaPrintln(src, 'trong scope')).toBe(cs.id)
  })

  it('ra khỏi scope thì println gắn lại job ngoài', () => {
    // Canh việc POP ngăn xếp. Nếu chỉ push mà không pop, ca này đỏ.
    const src = `fun main() = runBlocking {
    coroutineScope { println("trong") }
    println("sau")
}`
    const r = runSource(src)
    const gốc = r.events.find(e => e.k === 'COROUTINE_CREATED')!
    expect(idCủaPrintln(src, 'sau')).toBe(gốc.id)
  })

  it('scope inline ném exception vẫn pop đúng', () => {
    const src = `fun main() = runBlocking {
    try { coroutineScope { throw RuntimeException("boom") } } catch (e: RuntimeException) { }
    println("sau lỗi")
}`
    const r = runSource(src)
    const gốc = r.events.find(e => e.k === 'COROUTINE_CREATED')!
    expect(idCủaPrintln(src, 'sau lỗi')).toBe(gốc.id)
  })
})

describe('withContext đổi dispatcher thật', () => {
  it('thân withContext chạy trên thread của dispatcher mới', () => {
    const r = runSource(`fun main() = runBlocking {
    println("trên main")
    withContext(Dispatchers.IO) { println("trên IO") }
    println("về main")
}`)
    const threads = new Set(
      r.events.filter(e => e.k === 'THREAD_STATE').map(e => e.threadId),
    )
    expect([...threads].some(t => t.startsWith('IO-'))).toBe(true)
    expect([...threads].some(t => t.startsWith('Main-'))).toBe(true)
  })

  it('phát DISPATCH khi vào và khi ra khỏi withContext', () => {
    const r = runSource(`fun main() = runBlocking {
    withContext(Dispatchers.IO) { println("x") }
}`)
    const d = r.events.filter(e => e.k === 'DISPATCH')
    expect(d.length).toBeGreaterThanOrEqual(2)
    expect(d.some(e => e.dispatcher === 'IO')).toBe(true)
  })

  it('withContext CÙNG dispatcher thì KHÔNG đổi thread và không phát DISPATCH', () => {
    // Kotlin: withContext cùng dispatcher không dispatch lại. Nếu bỏ điều kiện
    // này thì mọi withContext đều sinh DISPATCH rác và bài học "đổi dispatcher"
    // mất hết ý nghĩa.
    const r = runSource(`fun main() = runBlocking {
    withContext(CoroutineName("chỉ đổi tên")) { println("x") }
}`)
    expect(r.events.filter(e => e.k === 'DISPATCH')).toHaveLength(0)
  })

  it('kết quả của withContext vẫn trả về đúng cho người gọi', () => {
    // Đổi thread không được làm mất giá trị trả về.
    const r = runSource(`fun main() = runBlocking {
    val v = withContext(Dispatchers.IO) { 5 }
    println(v)
}`)
    expect(r.output).toEqual(['5'])
  })

  it('println bên trong withContext vẫn đúng thứ tự so với bên ngoài', () => {
    const r = runSource(`fun main() = runBlocking {
    println("1")
    withContext(Dispatchers.IO) { println("2") }
    println("3")
}`)
    expect(r.output).toEqual(['1', '2', '3'])
  })
})

describe('DISPATCH khi coroutine con chạy trên dispatcher khác cha', () => {
  it('launch(Dispatchers.IO) từ Main phát DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch(Dispatchers.IO) { delay(10) }
    delay(50)
}`)
    expect(r.events.some(e => e.k === 'DISPATCH' && e.dispatcher === 'IO')).toBe(true)
  })

  it('launch cùng dispatcher với cha KHÔNG phát DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    expect(r.events.filter(e => e.k === 'DISPATCH')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/dispatch.test.ts`
Kỳ vọng: FAIL ở tất cả trừ hai ca "KHÔNG phát DISPATCH" (chúng xanh giả vì hiện chưa có DISPATCH nào cả — ghi nhận điều này trong báo cáo, chúng chỉ có giá trị SAU khi phần còn lại chạy).

- [ ] **Step 3: Ngăn xếp inline job**

Trong `scheduler.ts`.

**Ngăn xếp phải nằm TRÊN TASK, không phải trên Scheduler.** Một task có thể suspend ngay giữa thân một scope inline (`coroutineScope { delay(100) }`), và trong lúc nó treo thì task khác chạy. Ngăn xếp dùng chung ở mức Scheduler sẽ gán job inline của task đang treo cho `println` của task đang chạy — sai âm thầm, và sai theo kiểu chỉ hiện ra khi có hai coroutine xen kẽ.

```ts
interface Task {
  // ... các trường sẵn có ...
  /**
   * Các scope inline (runBlocking/coroutineScope/supervisorScope/withContext)
   * chạy trong generator của task NGOÀI, nên `currentJob` — vốn được gán từ
   * task.job ở đầu mỗi step() — không phải job đang thật sự thực thi. Ngăn xếp
   * này giữ job inline trong cùng CỦA RIÊNG TASK NÀY, và mọi event phát ra nhân
   * danh "job hiện tại" phải đọc qua đây.
   *
   * Trên Task chứ không trên Scheduler: task có thể treo giữa thân một scope
   * inline trong khi task khác chạy.
   */
  inlineStack: Job[]
}

private get jobHiệnTại(): Job | null {
  const t = this.taskĐangChạy
  return t ? (t.inlineStack[t.inlineStack.length - 1] ?? t.job) : this.currentJob
}
```

`spawnInline` push job vừa tạo vào ngăn xếp của task đang chạy; `completeInline` và `failInline` pop nó. Pop phải đúng job đang ở đỉnh — nếu không khớp, ném lỗi thay vì im lặng, vì lệch ngăn xếp sẽ gán nhầm job cho mọi println về sau:

```ts
private popInline(task: Task, job: Job): void {
  const đỉnh = task.inlineStack.pop()
  if (đỉnh !== job) {
    throw new Error(`Scheduler: ngăn xếp inline lệch — pop ${job.id} nhưng đỉnh là ${đỉnh?.id ?? 'rỗng'}`)
  }
}
```

Sửa `println` (`scheduler.ts:71-72`) dùng `this.jobHiệnTại`. Rà cả file xem còn chỗ nào đọc `currentJob` để gán id cho event không, và sửa cho nhất quán.

Thêm một ca test cho đúng lỗi mà việc đặt ngăn xếp trên Task ngăn được:

```ts
it('hai coroutine xen kẽ: println của cái này không mang job inline của cái kia', () => {
  const src = `fun main() = runBlocking {
    launch { coroutineScope { delay(50); println("trong scope A") } }
    launch { delay(10); println("B ngoài scope") }
    delay(200)
}`
  const r = runSource(src)
  const a = r.events.find(e => e.k === 'PRINTLN' && e.text === 'trong scope A')!
  const b = r.events.find(e => e.k === 'PRINTLN' && e.text === 'B ngoài scope')!
  const cs = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'coroutineScope')!
  expect(a.id).toBe(cs.id)
  expect(b.id).not.toBe(cs.id)
})
```

- [ ] **Step 4: Suspension `switchContext`**

Trong `suspension.ts` thêm biến thể:

```ts
/** Đổi dispatcher giữa chừng (withContext). Task được xếp lại hàng ready của pool mới. */
| { s: 'switchContext'; jobId: JobId; dispatcher: string; line?: number }
```

Trong `Scheduler.suspend`, thêm case:

```ts
case 'switchContext': {
  task.ctx = task.ctx.withDispatcher(s.dispatcher)
  // Thread cũ đã được release ở cuối step(); thread mới sẽ acquire ở step kế.
  // DISPATCH phát ở đây, mang threadId sẽ dùng — nhưng threadId chỉ biết được
  // sau khi acquire, nên phát ở đầu step() kế thay vì ở đây (xem Step 5).
  this.pendingDispatch.add(task)
  this.ready.push(task)
  break
}
```

Lưu ý: `COROUTINE_SUSPENDED` được phát ở đầu `suspend()` cho mọi biến thể (dòng ~318). `switchContext` KHÔNG phải một điểm suspend mà người học cần thấy như `delay`/`await` — nếu phát ra sẽ làm nhiễu timeline. Loại nó ra khỏi chỗ phát `COROUTINE_SUSPENDED` bằng điều kiện tường minh, và ghi rõ lý do bằng comment.

- [ ] **Step 5: Phát `DISPATCH`**

Trong `step()`, ngay sau khi `acquire` thành công và biết `threadId`:

```ts
// DISPATCH nghĩa là ĐỔI dispatcher, không phải "được xếp lịch". Phát khi:
//  - task vừa qua switchContext (withContext đổi dispatcher), hoặc
//  - lần chạy đầu tiên của một coroutine có dispatcher khác cha nó.
// Nếu phát ở mọi lần acquire thì nó trùng lặp COROUTINE_STARTED/RESUMED và
// mất hẳn ý nghĩa "chỗ này đổi thread".
if (this.pendingDispatch.delete(task) || this.làLầnĐầuKhácCha(task)) {
  this.emitter.emit({ k: 'DISPATCH', id: job.id, dispatcher: task.ctx.dispatcher, threadId })
}
```

`làLầnĐầuKhácCha`: `!task.started && dispatcher của task !== dispatcher của job cha`. Dispatcher của cha đọc từ ctx của task cha; nếu không có cha thì coi như không khác (không phát).

- [ ] **Step 6: Interpreter — `withContext` yield điểm đổi**

Trong nhánh builder `withContext` (`interpreter.ts:325+`), sau khi `spawnInline` và TRƯỚC khi chạy thân, nếu dispatcher mới khác dispatcher hiện hành thì yield điểm đổi; sau khi thân xong (cả đường thuận lẫn đường ném) thì đổi về:

```ts
const dispatcherCũ = /* dispatcher của env/task hiện tại — đọc từ job cha */
const dispatcherMới = ctx.dispatcher
const cầnĐổi = calleeName === 'withContext' && dispatcherMới !== dispatcherCũ
if (cầnĐổi) yield { s: 'switchContext', jobId: job.id, dispatcher: dispatcherMới, line: e.pos.line }
try {
  // ... thân như hiện tại ...
} finally {
  if (cầnĐổi) yield { s: 'switchContext', jobId: job.id, dispatcher: dispatcherCũ }
}
```

`yield` trong `finally` là hợp lệ với generator JS và là cách duy nhất bảo đảm đổi về cả khi thân ném — cùng lý do mà `finally` của Kotlin chạy được khi bị cancel (spec §2.3).

Cẩn thận: `dispatcherCũ` phải là dispatcher THẬT của task đang chạy, không phải của job cha theo cấu trúc — hai cái này khác nhau khi có `withContext` lồng nhau. Cách chắc chắn nhất là hỏi scheduler: thêm `Scheduler.dispatcherHiệnTại(): string` trả `task.ctx.dispatcher` của task đang chạy.

- [ ] **Step 7: Chạy toàn bộ**

Chạy: `npx vitest run`, `npm run typecheck`, `npm run lint`.
Kỳ vọng: PASS. Việc sửa attribution của println làm ĐỔI `id` trên nhiều `PRINTLN` event — test cũ nào khẳng định id cũ là test khẳng định hành vi sai, cập nhật và ghi vào báo cáo.

- [ ] **Step 8: Red-check**

1. Bỏ `popInline` (chỉ push) → ca "ra khỏi scope thì println gắn lại job ngoài" phải đỏ.
2. Bỏ điều kiện `dispatcherMới !== dispatcherCũ` (luôn đổi) → ca "CÙNG dispatcher thì KHÔNG phát DISPATCH" phải đỏ.
3. Bỏ `yield` trong `finally` → ca "println bên trong withContext vẫn đúng thứ tự" hoặc một ca khác phải đỏ; nếu KHÔNG ca nào đỏ thì bộ test chưa canh được đường ném — thêm ca `withContext(Dispatchers.IO) { throw ... }` rồi kiểm dispatcher sau đó đã về Main, và ghi lại.
4. Phát `DISPATCH` ở mọi lần acquire → ca "launch cùng dispatcher KHÔNG phát DISPATCH" phải đỏ.

- [ ] **Step 9: Commit**

```bash
git add src/engine/runtime/scheduler.ts src/engine/runtime/suspension.ts src/engine/interpreter/interpreter.ts tests/engine/dispatch.test.ts
git commit -m "feat(engine): withContext đổi dispatcher thật, phát DISPATCH, println gắn đúng job"
```

---

### Task 7: Hạ tầng golden trace

Spec §7 quy định mỗi lesson có `expected-trace.json`, và §9 liệt kê "Golden trace" là một loại test riêng. Hiện KHÔNG có file nào như vậy: `tests/lessons/golden.test.ts` chỉ chứa assertion ngữ nghĩa viết tay. Assertion ngữ nghĩa vẫn cần — nhưng nó không bắt được thay đổi ngoài dự kiến ở những chỗ nó không nhìn tới, và trong M1/M2 đã có 8 lần loại test này xanh trong khi không canh gì cả.

Hai loại test, hai nhiệm vụ khác nhau, giữ cả hai:
- **Golden JSON** — so sánh nguyên `Event[]`. Bắt MỌI thay đổi. Diff của nó trả lời câu hỏi "engine có đổi không", con người quyết định "đổi thế có đúng không".
- **Assertion ngữ nghĩa** — phát biểu điều PHẢI đúng bất kể hình dạng trace. Sống sót qua refactor.

Golden JSON an toàn ở đây vì engine deterministic thật: `JobId` (`j1, j2, …`) và `ThreadId` (`Main-1, …`) sinh bằng bộ đếm tuần tự, không random, không `Date.now` (ESLint cấm tường minh trong `src/engine/**`).

Đồng thời task này gỡ danh sách lesson hard-code. Hiện thêm một lesson phải sửa tay 4 chỗ: `src/lessons/index.ts:9` (`LESSON_IDS`), `tests/lessons/golden.test.ts:20`, `tests/ui/lesson-registry.test.ts:20` (`toHaveLength(3)`), `tests/ui/acceptance-m2.test.ts:10`. Bốn nguồn sự thật cho cùng một danh sách là ba nguồn thừa.

**Files:**
- Create: `scripts/update-golden.ts`
- Modify: `package.json` (script `golden:update`)
- Modify: `src/lessons/index.ts` (đọc thư mục thay vì mảng hard-code)
- Modify: `tests/lessons/golden.test.ts` (thêm phần so golden JSON; bỏ danh sách cứng)
- Modify: `tests/ui/lesson-registry.test.ts`, `tests/ui/acceptance-m2.test.ts` (bỏ số đếm cứng)
- Create: `src/lessons/{jobtree,normalfail,supervisor}/expected-trace.json`

**Interfaces:**
- Produces: `LESSON_IDS` suy từ thư mục con của `src/lessons/` có `main.kt`, sắp theo `order` trong `meta.json`.
- Produces: định dạng golden — `{ "output": string[], "events": Event[] }`, JSON 2 space, có newline cuối.
- Produces: `npm run golden:update` ghi lại `expected-trace.json` cho mọi lesson.

- [ ] **Step 1: Bỏ danh sách hard-code trong `src/lessons/index.ts`**

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LessonMeta {
  id: string; order: number; title: string; summary: string; concepts: string[]
}

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Suy từ thư mục, không phải từ mảng viết tay. Trước đây danh sách này bị chép
 * ra bốn chỗ và thêm một lesson phải nhớ sửa cả bốn.
 * Sắp theo `order` để khớp `registry.ts` (đường browser) — hai đường phải cho
 * ra cùng thứ tự, nếu không thì test và UI nói về hai bài khác nhau.
 */
export const LESSONS: LessonMeta[] = readdirSync(here, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => join(here, d.name, 'meta.json'))
  .map(p => JSON.parse(readFileSync(p, 'utf8')) as LessonMeta)
  .sort((a, b) => a.order - b.order)

export const LESSON_IDS: string[] = LESSONS.map(l => l.id)

export function loadLessonSource(id: string): string {
  return readFileSync(join(here, id, 'main.kt'), 'utf8')
}

export function loadGoldenTrace(id: string): { output: string[]; events: unknown[] } {
  return JSON.parse(readFileSync(join(here, id, 'expected-trace.json'), 'utf8'))
}
```

Thêm `concepts: string[]` vào `meta.json` của cả ba lesson đang có (mảng khái niệm liên quan, theo spec §7), và vào `LessonMeta` của `registry.ts` cho khớp.

- [ ] **Step 2: Script sinh golden**

Tạo `scripts/update-golden.ts`:

```ts
/**
 * Sinh lại expected-trace.json cho mọi lesson.
 * Chạy: npm run golden:update
 *
 * Chỉ chạy khi engine đổi CÓ CHỦ ĐÍCH. Chạy nó để làm test xanh là cách nhanh
 * nhất biến golden test thành vật trang trí.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LESSONS, loadLessonSource } from '../src/lessons'
import { runSource } from '../src/engine/run'

const lessonsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lessons')

for (const l of LESSONS) {
  const r = runSource(loadLessonSource(l.id))
  if (r.diagnostics.length > 0) {
    throw new Error(`lesson ${l.id} có diagnostic, không sinh golden: ${JSON.stringify(r.diagnostics)}`)
  }
  const đích = join(lessonsDir, l.id, 'expected-trace.json')
  writeFileSync(đích, JSON.stringify({ output: r.output, events: r.events }, null, 2) + '\n')
  console.log(`${l.id}: ${r.events.length} event, ${r.output.length} dòng output`)
}
```

Thêm vào `package.json`: `"golden:update": "tsx scripts/update-golden.ts"`. Kiểm tra `tsx` có sẵn chưa (`npx tsx --version`); nếu chưa có thì dùng `vite-node` (đã có sẵn qua vitest) thay vì thêm dependency mới: `"golden:update": "vite-node scripts/update-golden.ts"`. KHÔNG thêm dependency mới — Global Constraints cấm.

- [ ] **Step 3: Viết test golden**

Thêm vào `tests/lessons/golden.test.ts` (giữ nguyên toàn bộ assertion ngữ nghĩa đang có):

```ts
import { LESSONS, loadGoldenTrace, loadLessonSource } from '../../src/lessons'

describe('golden trace — trace sinh ra khớp fixture đã chốt', () => {
  for (const l of LESSONS) {
    it(`${l.id}: events và output khớp expected-trace.json`, () => {
      const r = runSource(loadLessonSource(l.id))
      const golden = loadGoldenTrace(l.id)
      // So output TRƯỚC: khi nó lệch, thông báo lỗi đọc được ngay, trong khi
      // diff của 50 event thì không.
      expect(r.output).toEqual(golden.output)
      expect(r.events).toEqual(golden.events)
    })
  }

  it('mọi lesson đều có golden và golden không rỗng', () => {
    // Canh chính hạ tầng: một lesson thiếu file, hay một golden rỗng do script
    // chạy hỏng, sẽ làm vòng lặp trên duyệt qua mà không kiểm gì.
    expect(LESSONS.length).toBeGreaterThanOrEqual(3)
    for (const l of LESSONS) {
      const g = loadGoldenTrace(l.id)
      expect(g.events.length, `${l.id} có golden rỗng`).toBeGreaterThan(5)
    }
  })
})
```

Sửa `tests/lessons/golden.test.ts:20` (`toEqual(['jobtree','normalfail','supervisor'])`) thành khẳng định vẫn có giá trị mà không phải cập nhật mỗi lần thêm bài:

```ts
it('LESSONS xếp tăng dần theo order và order không trùng', () => {
  const orders = LESSONS.map(l => l.order)
  expect(orders).toEqual([...orders].sort((a, b) => a - b))
  expect(new Set(orders).size).toBe(orders.length)
})
```

Sửa `tests/ui/lesson-registry.test.ts:20` và `tests/ui/acceptance-m2.test.ts:10` để lấy danh sách từ `registry.ts` thay vì đếm cứng — nhưng test "hai đường Node và browser cho ra cùng danh sách" phải GIỮ, đó là test có giá trị thật.

- [ ] **Step 4: Sinh golden lần đầu và soi bằng mắt**

Chạy: `npm run golden:update`

Rồi ĐỌC một file vừa sinh (`src/lessons/normalfail/expected-trace.json`) và tự kiểm: `FAILURE_PROPAGATED` có `blockedBySupervisor: false`; ba job A/B/C đều kết thúc; output rỗng. Nếu thấy gì bất thường, dừng lại và báo — golden sai chốt vào là chốt luôn cái sai.

Ghi vào báo cáo số event của từng lesson.

- [ ] **Step 5: Chạy test và red-check**

Chạy: `npx vitest run tests/lessons/`

Red-check:
1. Sửa một ký tự trong `src/lessons/normalfail/expected-trace.json` (đổi `"boom"` thành `"boom2"`) → test golden của `normalfail` phải đỏ. Khôi phục.
2. Xoá tạm `src/lessons/supervisor/expected-trace.json` → test phải đỏ với thông báo dễ hiểu, không phải crash khó hiểu. Khôi phục.
3. Tạo tạm thư mục `src/lessons/thử/` với `meta.json` hợp lệ và `main.kt` rỗng → xác nhận nó TỰ ĐỘNG xuất hiện trong `LESSONS` (chứng minh đã bỏ được hard-code), rồi xoá đi.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-golden.ts package.json src/lessons/index.ts src/lessons/registry.ts src/lessons/jobtree src/lessons/normalfail src/lessons/supervisor tests/lessons/golden.test.ts tests/ui/lesson-registry.test.ts tests/ui/acceptance-m2.test.ts
git commit -m "feat(lessons): golden trace JSON + danh sách lesson suy từ thư mục"
```

---

## Ghi chú chung cho Task 8-11 (viết lesson)

Bốn task này cùng một khuôn. Đọc phần này trước khi làm bất kỳ task nào trong số đó.

**Mỗi lesson gồm 4 file** (file thứ 5, `expected-jvm-output.txt`, do Task 12 sinh):

```
src/lessons/<id>/main.kt                 # code Kotlin thật
src/lessons/<id>/meta.json               # { id, order, title, summary, concepts }
src/lessons/<id>/mental-model.md          # Task 15 viết; task này tạo file với nội dung tạm 1 dòng
src/lessons/<id>/expected-trace.json      # sinh bằng `npm run golden:update`
```

**`main.kt` phải là Kotlin THẬT chạy được**, không phải Kotlin gần đúng: dán nguyên vào `play.kotlinlang.org` phải biên dịch và chạy. Nghĩa là có `import kotlinx.coroutines.*` ở đầu, và không dùng construct nào mà Kotlin thật không có. Task 12 sẽ chạy đúng file này trên JVM thật và đối chiếu output — sai chỗ nào sẽ lộ ra ở đó.

**Thứ tự phải deterministic trên CẢ Kotlin thật.** Simulator deterministic theo thiết kế, nhưng Kotlin thật thì không, trừ khi code buộc nó phải thế. Dùng `delay` với giá trị KHÁC NHAU để định thứ tự, và `join()`/`await()` để nối các đoạn — đừng bao giờ dựa vào "hai coroutine cùng bắt đầu thì cái nào in trước".

**Không dùng `Dispatchers.Main`** trong lesson: trên JVM thường (không Android, không JavaFX) nó ném `IllegalStateException` lúc khởi tạo. Simulator có `Main` và graph vẫn hiện được, nhưng fixture JVM sẽ vỡ.

**`order`**: theo đúng thứ tự dạy của bản HTML gốc —
`suspend` 1, `jobtree` 2, `exception` 3, `normalfail` 4, `supervisor` 5, `launchasync` 6, `dispatcher` 7, `scopecompare` 8, `nestedtrap` 9.
Ba lesson đã có (`jobtree`, `normalfail`, `supervisor`) đang mang `order` khác — Task 8 sửa lại cho đúng ba số trên.

**`meta.json`**:
```json
{
  "id": "<id>",
  "order": <số>,
  "title": "<tiêu đề ngắn, có gạch ngang tách ý chính>",
  "summary": "<một câu, dưới 80 ký tự>",
  "concepts": ["<khái niệm 1>", "<khái niệm 2>"]
}
```
Lấy nội dung từ `docs/reference/legacy-scenarios.md` (trường `title`, `sub`, `desc`, `concept` của kịch bản tương ứng) — bảo toàn cách diễn đạt của tác giả, đừng viết lại.

**Sau khi thêm lesson:** chạy `npm run golden:update`, ĐỌC golden vừa sinh của lesson mới, tự kiểm nó có đúng bài học không, rồi commit cả golden.

**Test cho mỗi lesson** đặt trong `tests/lessons/<id>.test.ts`, phát biểu ĐIỀU BÀI HỌC DẠY dưới dạng khẳng định về trace — không chép lại golden. Nếu test chỉ khẳng định `output` khớp một mảng chuỗi thì nó trùng với golden và không thêm giá trị gì; phải khẳng định về CƠ CHẾ (quan hệ cha con, chiều lan truyền, `blockedBySupervisor`, trạng thái cuối của từng job).

---

### Task 8: Lesson `suspend` và `exception`

`suspend` là bài mở đầu: tách trạng thái THỰC THI (coroutine đang suspend) khỏi trạng thái VÒNG ĐỜI (Job vẫn Active). Đây là hiểu lầm phổ biến nhất và là lý do `job.isActive` phải chạy được (Task 4).

`exception` dạy phân biệt: exception là thứ bị NÉM; failure là Job KẾT THÚC BẤT THƯỜNG. Exception bị bắt thì không có failure nào cả.

**Files:**
- Modify: `src/engine/lexer/lexer.ts` hoặc `src/engine/parser/parser.ts` (bỏ qua dòng `import`)
- Create: `src/lessons/suspend/{main.kt,meta.json,mental-model.md}`
- Create: `src/lessons/exception/{main.kt,meta.json,mental-model.md}`
- Modify: `src/lessons/{jobtree,normalfail,supervisor}/meta.json` (sửa `order`, thêm `concepts`)
- Modify: `src/lessons/{jobtree,normalfail,supervisor}/main.kt` (thêm dòng `import`)
- Create: `tests/lessons/suspend.test.ts`, `tests/lessons/exception.test.ts`
- Create: `tests/engine/import.test.ts`

- [ ] **Step 1: Parser bỏ qua `import`**

Lesson phải chạy được trên JVM thật nên `main.kt` cần `import kotlinx.coroutines.*`. Simulator không có hệ thống module, nên nó BỎ QUA dòng import — nhưng phải bỏ qua tường minh, không phải vỡ.

Test trước (`tests/engine/import.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('dòng import', () => {
  it('bỏ qua import mà không báo lỗi', () => {
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    println("chạy")
}`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['chạy'])
  })

  it('nhiều import liên tiếp cũng được', () => {
    const r = runSource(`import kotlinx.coroutines.*
import kotlin.system.measureTimeMillis

fun main() = runBlocking { println("ok") }`)
    expect(r.diagnostics).toEqual([])
    expect(r.output).toEqual(['ok'])
  })

  it('import KHÔNG làm lệch số dòng của diagnostic', () => {
    // Nếu cài bằng cách xoá dòng import khỏi source trước khi lex, mọi số dòng
    // sau đó lệch đi và diagnostic trỏ sai chỗ — lỗi lặng lẽ nhất có thể.
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    println(Channel)
}`)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]!.line).toBe(4)
  })
})
```

Chạy, xác nhận đỏ. Cài ở tầng parser (bỏ qua câu bắt đầu bằng từ khoá `import` cho tới hết dòng), KHÔNG cài bằng cách sửa chuỗi source trước khi lex — ca thứ ba canh đúng chỗ đó.

- [ ] **Step 2: `src/lessons/suspend/main.kt`**

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        println("1. coroutine bắt đầu chạy")
        delay(1000)
        println("3. resume — cùng coroutine, chạy tiếp từ đúng chỗ đã dừng")
    }

    delay(10)
    println("2. coroutine đang SUSPENDED, nhưng job.isActive = " + job.isActive)

    job.join()
    println("4. xong: isActive = " + job.isActive + ", isCompleted = " + job.isCompleted)
}
```

- [ ] **Step 3: `src/lessons/suspend/meta.json`**

```json
{
  "id": "suspend",
  "order": 1,
  "title": "suspend — dừng mà không chặn thread",
  "summary": "Coroutine SUSPENDED nhưng Job vẫn ACTIVE. Hai trạng thái khác nhau.",
  "concepts": ["suspend", "delay", "Job.isActive", "continuation"]
}
```

- [ ] **Step 4: `src/lessons/exception/main.kt`**

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    val bắtĐược = launch {
        try {
            error("boom")
        } catch (e: IllegalStateException) {
            println("1. bắt được exception: " + e.message)
        }
        println("2. job này KHÔNG fail — exception đã được xử lý")
    }
    bắtĐược.join()
    println("3. isCancelled = " + bắtĐược.isCancelled)

    try {
        coroutineScope {
            launch { throw RuntimeException("không ai bắt") }
        }
    } catch (e: RuntimeException) {
        println("4. exception thoát khỏi coroutine => Job FAIL: " + e.message)
    }
    println("5. hết bài")
}
```

Tên biến tiếng Việt có dấu là hợp lệ trong Kotlin (định danh Unicode) và làm bài học dễ đọc hơn với người học Việt. Nếu lexer của simulator chưa nhận định danh Unicode, ĐỔI TÊN BIẾN thành không dấu (`batDuoc`) thay vì sửa lexer — mở rộng bộ ký tự định danh là thay đổi ngoài phạm vi M3, và nó cần bộ test riêng.

- [ ] **Step 5: `src/lessons/exception/meta.json`**

```json
{
  "id": "exception",
  "order": 3,
  "title": "Exception vs Failure — không phải một",
  "summary": "Exception bị bắt thì không có failure. Chỉ exception thoát ra mới làm Job fail.",
  "concepts": ["exception", "failure", "try/catch", "coroutineScope"]
}
```

- [ ] **Step 6: Sửa `order` và thêm `concepts` cho ba lesson cũ, thêm `import`**

`jobtree` → `order: 2`; `normalfail` → `order: 4`; `supervisor` → `order: 5`. Thêm `concepts` cho cả ba, lấy từ trường `concept` của kịch bản tương ứng trong `docs/reference/legacy-scenarios.md`. Thêm `import kotlinx.coroutines.*` + dòng trống vào đầu cả ba `main.kt`.

Thêm `mental-model.md` cho cả 5 lesson với nội dung tạm đúng một dòng: `TODO(Task 15): phần mental model viết tay.` — Task 15 sẽ thay. Đây là chỗ duy nhất trong plan cho phép nội dung tạm, và nó có task cụ thể chịu trách nhiệm thay.

- [ ] **Step 7: Test cho hai lesson**

`tests/lessons/suspend.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { loadLessonSource } from '../../src/lessons'
import { foldTrace } from '../../src/engine/trace/world'

const r = () => runSource(loadLessonSource('suspend'))

describe('lesson suspend — Job vẫn Active khi coroutine đang suspend', () => {
  it('parse và validate sạch', () => {
    expect(r().diagnostics).toEqual([])
  })

  it('tại lúc in isActive, job THẬT SỰ đang ở trạng thái suspend vì delay', () => {
    // Khẳng định về CƠ CHẾ, không chỉ về chuỗi in ra: tìm event PRINTLN của
    // dòng "2." rồi fold tới ngay trước nó và kiểm trạng thái job con.
    const kq = r()
    const i = kq.events.findIndex(e => e.k === 'PRINTLN' && e.text.startsWith('2.'))
    expect(i).toBeGreaterThan(-1)
    const w = foldTrace(kq.events, i)
    const con = [...w.jobs.values()].find(j => j.builder === 'launch')!
    expect(con.state).toBe('Active')
    expect(con.suspendReason).toBe('delay')
    expect(con.threadId).toBeNull()   // suspend = TRẢ thread về pool, không giữ
  })

  it('thread được trả về pool trong lúc delay, không bị giữ', () => {
    const kq = r()
    const i = kq.events.findIndex(e => e.k === 'PRINTLN' && e.text.startsWith('2.'))
    const w = foldTrace(kq.events, i)
    expect([...w.threads.values()].every(t => t.state === 'FREE')).toBe(true)
  })

  it('coroutine resume và chạy tiếp đúng chỗ đã dừng, ở đúng t = 1000', () => {
    const kq = r()
    const b = kq.events.find(e => e.k === 'PRINTLN' && e.text.startsWith('3.'))!
    expect(b.t).toBe(1000)
  })
})
```

`tests/lessons/exception.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { loadLessonSource } from '../../src/lessons'

const r = () => runSource(loadLessonSource('exception'))

describe('lesson exception — exception bị bắt thì KHÔNG có failure', () => {
  it('parse và validate sạch', () => {
    expect(r().diagnostics).toEqual([])
  })

  it('nhánh bắt được: có EXCEPTION_THROWN nhưng KHÔNG có FAILURE_PROPAGATED nào từ nó', () => {
    const kq = r()
    const ném = kq.events.filter(e => e.k === 'EXCEPTION_THROWN')
    expect(ném.map(e => e.exType)).toContain('IllegalStateException')
    // Job bắt được exception phải kết thúc BÌNH THƯỜNG.
    const jobBắt = ném.find(e => e.exType === 'IllegalStateException')!.id
    const fail = kq.events.filter(e => e.k === 'FAILURE_PROPAGATED')
    expect(fail.some(e => e.from === jobBắt)).toBe(false)
    const cuối = kq.events.filter(e => e.k === 'JOB_STATE' && e.id === jobBắt).pop()!
    expect(cuối.to).toBe('Completed')
  })

  it('nhánh không bắt: failure lan lên và scope ném lại cho người gọi', () => {
    const kq = r()
    expect(kq.events.some(e => e.k === 'FAILURE_PROPAGATED' && !e.blockedBySupervisor)).toBe(true)
    expect(kq.output.some(l => l.startsWith('4.'))).toBe(true)
  })

  it('chương trình chạy hết bài, không chết giữa chừng', () => {
    expect(r().output.some(l => l.startsWith('5.'))).toBe(true)
  })
})
```

- [ ] **Step 8: Sinh golden, chạy, red-check**

```bash
npm run golden:update
npx vitest run
npm run typecheck && npm run lint && npm run build
```

Đọc `src/lessons/suspend/expected-trace.json` và `src/lessons/exception/expected-trace.json`, tự kiểm chúng thể hiện đúng bài học.

Red-check:
1. Đổi `delay(10)` trong `suspend/main.kt` thành `delay(2000)` (in isActive SAU khi job xong) → test "job đang suspend" phải đỏ. Khôi phục và regenerate golden.
2. Trong `exception/main.kt`, đổi `catch (e: IllegalStateException)` thành bắt kiểu khác không khớp → test "nhánh bắt được" phải đỏ. Khôi phục.

- [ ] **Step 9: Commit**

```bash
git add src/engine/parser/parser.ts tests/engine/import.test.ts src/lessons tests/lessons
git commit -m "feat(lessons): thêm lesson suspend và exception, parser bỏ qua import"
```

---

### Task 9: Lesson `launchasync`

`launch` và `async` khác nhau ở BA điểm, và bài học phải cho thấy cả ba: (1) `launch` trả `Job`, `async` trả `Deferred<T>` mang giá trị; (2) `join()` chỉ chờ, `await()` chờ VÀ đọc kết quả; (3) exception trong `async` nằm im trong `Deferred` cho tới khi có người `await()` — nhưng vẫn lan lên cha theo cấu trúc, độc lập với việc có ai await hay không.

Điểm (3) là chỗ hay bị hiểu sai nhất, và là chỗ Task 3 vừa sửa. Bài này phụ thuộc trực tiếp vào Task 3.

**Files:**
- Create: `src/lessons/launchasync/{main.kt,meta.json,mental-model.md}`
- Create: `tests/lessons/launchasync.test.ts`

- [ ] **Step 1: `main.kt`**

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        val j = launch {
            delay(100)
            println("1. launch chạy xong — không trả giá trị nào")
        }
        j.join()
        println("2. join() chỉ CHỜ, không đọc được gì")

        val d = async {
            delay(100)
            42
        }
        println("3. await() vừa chờ vừa trả về: " + d.await())

        val hỏng = async { throw RuntimeException("boom") }
        delay(50)
        println("4. Deferred đã fail từ lúc nãy, nhưng chưa ai đọc nên chưa ai thấy")
        try {
            hỏng.await()
            println("dòng này không bao giờ chạy")
        } catch (e: RuntimeException) {
            println("5. await() ném exception ra tại ĐÚNG chỗ gọi await: " + e.message)
        }
    }
    println("6. supervisorScope chặn failure của async, chương trình đi tiếp")
}
```

Đặt tên biến `hỏng` — nếu lexer chưa nhận định danh có dấu (xem Task 8 Step 4), đổi thành `hong`.

- [ ] **Step 2: `meta.json`**

```json
{
  "id": "launchasync",
  "order": 6,
  "title": "launch vs async — Job vs Deferred",
  "summary": "join() chỉ chờ; await() chờ và đọc, nên await() mới là chỗ exception hiện ra.",
  "concepts": ["launch", "async", "Deferred", "await", "join"]
}
```

- [ ] **Step 3: Test**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { loadLessonSource } from '../../src/lessons'

const r = () => runSource(loadLessonSource('launchasync'))

describe('lesson launchasync', () => {
  it('parse và validate sạch', () => {
    expect(r().diagnostics).toEqual([])
  })

  it('có đúng một job builder async mang giá trị, và await trả về nó', () => {
    const kq = r()
    expect(kq.events.some(e => e.k === 'COROUTINE_CREATED' && e.builder === 'async')).toBe(true)
    expect(kq.output.find(l => l.startsWith('3.'))).toContain('42')
  })

  it('Deferred fail TRƯỚC lúc await: EXCEPTION_THROWN xảy ra sớm hơn dòng in "4."', () => {
    // Đây là điểm bài học: thất bại đã có sẵn, chỉ chưa ai đọc.
    const kq = r()
    const ném = kq.events.find(e => e.k === 'EXCEPTION_THROWN' && e.message === 'boom')!
    const dòng4 = kq.events.find(e => e.k === 'PRINTLN' && e.text.startsWith('4.'))!
    expect(ném.seq).toBeLessThan(dòng4.seq)
  })

  it('await() ném ra và code bắt được — không phải scope bị cancel', () => {
    const kq = r()
    expect(kq.output.some(l => l.startsWith('5.'))).toBe(true)
    expect(kq.output.some(l => l.includes('không bao giờ chạy'))).toBe(false)
  })

  it('supervisor CHẶN failure của async, scope không chết', () => {
    const kq = r()
    expect(kq.events.some(e => e.k === 'FAILURE_PROPAGATED' && e.blockedBySupervisor)).toBe(true)
    expect(kq.output.some(l => l.startsWith('6.'))).toBe(true)
  })

  it('chạy đủ 6 dòng, đúng thứ tự', () => {
    const đầuDòng = r().output.map(l => l.slice(0, 1))
    expect(đầuDòng).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})
```

- [ ] **Step 4: Sinh golden, chạy, red-check**

```bash
npm run golden:update && npx vitest run
```

Red-check: trong `main.kt`, bỏ `try/catch` quanh `hỏng.await()` → test "await() ném ra và code bắt được" phải đỏ, và output phải đổi. Khôi phục, regenerate golden.

- [ ] **Step 5: Commit**

```bash
git add src/lessons/launchasync tests/lessons/launchasync.test.ts
git commit -m "feat(lessons): thêm lesson launchasync"
```

---

### Task 10: Lesson `dispatcher`

Dạy ba thứ: context là tổ hợp element cộng bằng `+`; con thừa kế context của scope; và `withContext` đổi dispatcher GIỮA CHỪNG một coroutine — cùng một coroutine, thread khác.

Bài này phụ thuộc Task 5 (`CoroutineScope(ctx)` có Job gốc) và Task 6 (`withContext` đổi thread thật, phát `DISPATCH`).

Thread ảo KHÔNG được in ra bằng `println`: `Thread.currentThread()` là interop Java, nằm ngoài subset §4.1 và đã bị chặn ở Task 2. Người học thấy thread qua badge trên đồ thị và qua event `DISPATCH` trên timeline — đó là lý do công cụ này tồn tại thay vì đọc log.

**Files:**
- Create: `src/lessons/dispatcher/{main.kt,meta.json,mental-model.md}`
- Create: `tests/lessons/dispatcher.test.ts`

- [ ] **Step 1: `main.kt`**

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))

    val j = scope.launch {
        println("1. thân coroutine chạy trên pool IO — thừa kế từ context của scope")

        withContext(Dispatchers.Default) {
            println("2. withContext đổi sang pool Default: vẫn CÙNG coroutine, khác thread")
        }

        println("3. ra khỏi withContext, quay lại pool IO")
    }
    j.join()

    scope.cancel()
    println("4. scope bị cancel — mọi con của nó cũng vậy")
}
```

- [ ] **Step 2: `meta.json`**

```json
{
  "id": "dispatcher",
  "order": 7,
  "title": "Context và Dispatcher — ai chạy trên thread nào",
  "summary": "Context cộng bằng +, con thừa kế của cha, withContext đổi thread giữa chừng.",
  "concepts": ["CoroutineContext", "Dispatchers", "CoroutineName", "withContext", "SupervisorJob"]
}
```

- [ ] **Step 3: Test**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { loadLessonSource } from '../../src/lessons'

const r = () => runSource(loadLessonSource('dispatcher'))

describe('lesson dispatcher', () => {
  it('parse và validate sạch', () => {
    expect(r().diagnostics).toEqual([])
  })

  it('scope là Job gốc supervisor, con của nó thừa kế IO và tên worker', () => {
    const tạo = r().events.filter(e => e.k === 'COROUTINE_CREATED')
    const scope = tạo.find(e => e.builder === 'scope')!
    expect(scope.parentId).toBeNull()
    expect(scope.ctx.isSupervisor).toBe(true)
    const con = tạo.find(e => e.builder === 'launch')!
    expect(con.parentId).toBe(scope.id)
    expect(con.ctx.dispatcher).toBe('IO')
    expect(con.ctx.name).toBe('worker')
  })

  it('withContext thật sự chạy trên thread của pool Default rồi trả về IO', () => {
    const kq = r()
    const d = kq.events.filter(e => e.k === 'DISPATCH')
    expect(d.map(e => e.dispatcher)).toEqual(['IO', 'Default', 'IO'])
  })

  it('ba dòng 1-2-3 do CÙNG một coroutine gốc sinh ra, nhưng dòng 2 mang job withContext', () => {
    // Bài học "cùng coroutine, khác thread" chỉ đúng nếu 1 và 3 cùng job.
    const kq = r()
    const p = (s: string) => kq.events.find(e => e.k === 'PRINTLN' && e.text.startsWith(s))!
    expect(p('1.').id).toBe(p('3.').id)
    expect(p('2.').id).not.toBe(p('1.').id)
  })

  it('thread thực sự khác nhau giữa dòng 1 và dòng 2', () => {
    const kq = r()
    const threadTại = (s: string): string => {
      const i = kq.events.findIndex(e => e.k === 'PRINTLN' && e.text.startsWith(s))
      for (let k = i; k >= 0; k--) {
        const e = kq.events[k]!
        if (e.k === 'THREAD_STATE' && e.state === 'RUNNING') return e.threadId
      }
      throw new Error(`không tìm được thread đang chạy tại dòng ${s}`)
    }
    expect(threadTại('1.')).not.toBe(threadTại('2.'))
    expect(threadTại('1.').startsWith('IO-')).toBe(true)
    expect(threadTại('2.').startsWith('Default-')).toBe(true)
  })

  it('scope.cancel() huỷ scope root', () => {
    const kq = r()
    const scope = kq.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'scope')!
    const cuối = kq.events.filter(e => e.k === 'JOB_STATE' && e.id === scope.id).pop()!
    expect(cuối.to).toBe('Cancelled')
  })
})
```

- [ ] **Step 4: Sinh golden, chạy, red-check**

Red-check: đổi `withContext(Dispatchers.Default)` thành `withContext(Dispatchers.IO)` (cùng dispatcher) → test `DISPATCH` và test "thread khác nhau" phải đỏ. Khôi phục, regenerate golden.

- [ ] **Step 5: Commit**

```bash
git add src/lessons/dispatcher tests/lessons/dispatcher.test.ts
git commit -m "feat(lessons): thêm lesson dispatcher"
```

---

### Task 11: Lesson `scopecompare` và `nestedtrap`

Hai bài cuối, cả hai đã được đo là chạy đúng trên engine hiện tại (khảo sát 2026-08-12) nên rủi ro thấp nhất — nhưng chúng là hai bài dạy điều khó nhất.

`scopecompare`: đặt `coroutineScope` cạnh `supervisorScope` với thân giống hệt nhau, khác đúng một từ, để thấy hậu quả khác nhau hoàn toàn.

`nestedtrap`: cái bẫy — `supervisorScope` chỉ chặn failure của **con TRỰC TIẾP**. Đặt một `launch` thường ở giữa thì `launch` đó vẫn fail-fast với các con của nó, và người viết code tưởng mình đã được supervisor bảo vệ.

**Files:**
- Create: `src/lessons/scopecompare/{main.kt,meta.json,mental-model.md}`
- Create: `src/lessons/nestedtrap/{main.kt,meta.json,mental-model.md}`
- Create: `tests/lessons/scopecompare.test.ts`, `tests/lessons/nestedtrap.test.ts`

- [ ] **Step 1: `scopecompare/main.kt`**

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    try {
        coroutineScope {
            launch { delay(200); println("A xong (coroutineScope)") }
            launch { delay(50); throw RuntimeException("boom") }
        }
    } catch (e: RuntimeException) {
        println("1. coroutineScope: B fail => A bị huỷ, lỗi ném ra cho người gọi")
    }

    supervisorScope {
        launch { delay(200); println("2. A xong (supervisorScope) — vẫn sống") }
        launch { delay(50); throw RuntimeException("boom") }
    }
    println("3. supervisorScope: B fail bị chặn tại ranh giới, không ai bị huỷ")
}
```

- [ ] **Step 2: `scopecompare/meta.json`**

```json
{
  "id": "scopecompare",
  "order": 8,
  "title": "coroutineScope vs supervisorScope — khác đúng một từ",
  "summary": "Cùng một thân, một bên fail-fast kéo cả nhóm, một bên cô lập.",
  "concepts": ["coroutineScope", "supervisorScope", "fail-fast", "structured concurrency"]
}
```

- [ ] **Step 3: `nestedtrap/main.kt`**

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        launch {
            launch { delay(300); println("A xong — không bao giờ in") }
            launch { delay(50); throw RuntimeException("boom B") }
            launch { delay(300); println("C xong — không bao giờ in") }
        }
        delay(500)
        println("1. supervisorScope vẫn sống — nhưng nó chỉ cứu được CON TRỰC TIẾP")
    }
    println("2. A và C chết theo P, vì P là Job THƯỜNG nằm giữa")
}
```

- [ ] **Step 4: `nestedtrap/meta.json`**

```json
{
  "id": "nestedtrap",
  "order": 9,
  "title": "Cái bẫy lồng nhau — supervisor chỉ cứu con trực tiếp",
  "summary": "Một launch thường nằm giữa là đủ để cả nhánh con fail-fast trở lại.",
  "concepts": ["supervisorScope", "direct child", "supervisor boundary", "cancel đi xuống"]
}
```

- [ ] **Step 5: Test `scopecompare`**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { loadLessonSource } from '../../src/lessons'
import { foldTrace } from '../../src/engine/trace/world'

const r = () => runSource(loadLessonSource('scopecompare'))

describe('lesson scopecompare — cùng thân, khác một từ, khác hẳn kết quả', () => {
  it('parse và validate sạch', () => {
    expect(r().diagnostics).toEqual([])
  })

  it('A của coroutineScope bị CANCELLED, A của supervisorScope COMPLETED', () => {
    // Đây là toàn bộ bài học, phát biểu ở mức trạng thái job cuối cùng.
    const kq = r()
    const w = foldTrace(kq.events, kq.events.length)
    const cs = kq.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'coroutineScope')!
    const ss = kq.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'supervisorScope')!
    const conCủa = (id: string) => [...w.jobs.values()].filter(j => j.parentId === id)
    expect(conCủa(cs.id).filter(j => j.state === 'Cancelled').length).toBeGreaterThanOrEqual(1)
    expect(conCủa(ss.id).some(j => j.state === 'Completed')).toBe(true)
  })

  it('chỉ nhánh supervisorScope mới có cạnh failure blocked', () => {
    const kq = r()
    const fail = kq.events.filter(e => e.k === 'FAILURE_PROPAGATED')
    expect(fail.some(e => e.blockedBySupervisor)).toBe(true)
    expect(fail.some(e => !e.blockedBySupervisor)).toBe(true)
  })

  it('A của coroutineScope không kịp in, A của supervisorScope thì in được', () => {
    const kq = r()
    expect(kq.output.some(l => l.includes('A xong (coroutineScope)'))).toBe(false)
    expect(kq.output.some(l => l.startsWith('2.'))).toBe(true)
  })

  it('chạy hết bài', () => {
    expect(r().output.some(l => l.startsWith('3.'))).toBe(true)
  })
})
```

- [ ] **Step 6: Test `nestedtrap`**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { loadLessonSource } from '../../src/lessons'
import { foldTrace } from '../../src/engine/trace/world'

const r = () => runSource(loadLessonSource('nestedtrap'))

describe('lesson nestedtrap — supervisor chỉ chặn con TRỰC TIẾP', () => {
  it('parse và validate sạch', () => {
    expect(r().diagnostics).toEqual([])
  })

  it('failure của B lan lên P KHÔNG bị chặn, rồi P lên supervisorScope MỚI bị chặn', () => {
    // Hai bước lan truyền, hai kết quả khác nhau — đó chính là cái bẫy.
    const kq = r()
    const fail = kq.events.filter(e => e.k === 'FAILURE_PROPAGATED')
    expect(fail.length).toBeGreaterThanOrEqual(2)
    expect(fail[0]!.blockedBySupervisor).toBe(false)
    expect(fail[fail.length - 1]!.blockedBySupervisor).toBe(true)
  })

  it('A và C bị CANCELLED dù supervisorScope vẫn sống', () => {
    const kq = r()
    const w = foldTrace(kq.events, kq.events.length)
    const ss = kq.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'supervisorScope')!
    const p = [...w.jobs.values()].find(j => j.parentId === ss.id && j.builder === 'launch')!
    const cháu = [...w.jobs.values()].filter(j => j.parentId === p.id)
    expect(cháu).toHaveLength(3)
    expect(cháu.filter(j => j.state === 'Cancelled')).toHaveLength(3)
    expect(w.jobs.get(ss.id)!.state).toBe('Completed')
  })

  it('A và C không in được gì', () => {
    const kq = r()
    expect(kq.output.some(l => l.includes('A xong'))).toBe(false)
    expect(kq.output.some(l => l.includes('C xong'))).toBe(false)
    expect(kq.output.map(l => l.slice(0, 1))).toEqual(['1', '2'])
  })
})
```

- [ ] **Step 7: Sinh golden, chạy đủ 4 lệnh, red-check**

Red-check:
1. `scopecompare/main.kt`: đổi `supervisorScope` thứ hai thành `coroutineScope` → test "A của supervisorScope COMPLETED" phải đỏ. Khôi phục.
2. `nestedtrap/main.kt`: bỏ lớp `launch` ở giữa (cho A/B/C thành con trực tiếp của `supervisorScope`) → test "A và C bị CANCELLED" phải đỏ. Khôi phục, regenerate golden.

- [ ] **Step 8: Commit**

```bash
git add src/lessons/scopecompare src/lessons/nestedtrap tests/lessons/scopecompare.test.ts tests/lessons/nestedtrap.test.ts
git commit -m "feat(lessons): thêm lesson scopecompare và nestedtrap — đủ 9 lesson"
```

---

### Task 12: Đối chiếu với JVM thật — `expected-jvm-output.txt`

Golden trace neo simulator vào CHÍNH NÓ: nó bắt được thay đổi, nhưng nếu ngữ nghĩa sai ngay từ đầu thì nó chốt cái sai lại. Thứ duy nhất neo được simulator vào Kotlin THẬT là chạy đúng file `main.kt` đó trên JVM thật và so output.

Đây là tuyến phòng thủ mạnh nhất của cả dự án và nó rẻ: chạy một lần, ghi vào fixture, commit. `src/verify/` (gọi JVM từ trong app, cho code do user viết) là việc của M5 — task này chỉ tạo fixture và test offline.

API đã kiểm chứng chạy được ngày 2026-08-12:

```bash
curl -s -X POST 'https://api.kotlinlang.org/api/2.1.20/compiler/run' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://play.kotlinlang.org' \
  --data '{"args":"","files":[{"name":"File.kt","publicId":"","text":"<mã Kotlin>"}],"confType":"java"}'
```

Trả về JSON: `{"errors":{"File.kt":[...]},"exception":null|{...},"text":"<outStream>...</outStream>"}`. stdout nằm trong `text`, bọc trong thẻ `<outStream>`.

**Files:**
- Create: `scripts/fetch-jvm-output.ts`
- Create: `src/lessons/<id>/expected-jvm-output.txt` × 9
- Create: `tests/lessons/jvm-parity.test.ts`
- Modify: `package.json` (script `jvm:fetch`)
- Modify: `src/lessons/index.ts` (`loadJvmOutput`)

**Interfaces:**
- Produces: `loadJvmOutput(id: string): string[]` — các dòng stdout, đã bỏ dòng trống ở cuối.
- Produces: `npm run jvm:fetch` — chạy TAY, không nằm trong `npm test`. Test chỉ đọc fixture đã commit, nên bộ test chạy offline.

- [ ] **Step 1: Script lấy output**

Tạo `scripts/fetch-jvm-output.ts`. Với mỗi lesson: đọc `main.kt`, POST lên API, kiểm `errors` rỗng và `exception` null-hoặc-đã-biết, bóc `<outStream>…</outStream>` khỏi `text`, ghi ra `expected-jvm-output.txt`.

Bắt buộc trong script:
- Nếu `errors["File.kt"]` có phần tử `severity === "ERROR"` → **ném lỗi, KHÔNG ghi file**. Lesson không biên dịch được trên Kotlin thật là bug của lesson, không phải chuyện để ghi lại rồi đi tiếp.
- In ra màn hình `id`, số dòng output, và `exception` (nếu có) để người chạy soi được.
- Chờ 1 giây giữa các lesson (`await new Promise(r => setTimeout(r, 1000))`) — script nằm ngoài `src/engine/**` nên `setTimeout` không vi phạm ràng buộc ESLint; kiểm tra `eslint.config.js` có phủ `scripts/` không, nếu có thì thêm ngoại lệ cho thư mục đó.

- [ ] **Step 2: Chạy script và ĐỌC kết quả**

```bash
npm run jvm:fetch
```

Đọc từng file `expected-jvm-output.txt` vừa sinh. Với mỗi lesson, so bằng mắt với output của simulator (`npm run golden:update` in ra số dòng; hoặc đọc `expected-trace.json`).

**Nếu có lesson nào lệch: ĐỪNG sửa fixture, ĐỪNG sửa lesson để né.** Ghi lại chính xác lệch chỗ nào, dừng lại, và báo cáo với trạng thái DONE_WITH_CONCERNS kèm bảng so sánh. Lệch ở đây nghĩa là simulator sai so với Kotlin thật — đó là phát hiện có giá trị nhất mà task này có thể tạo ra, và cách xử lý nó là quyết định của con người, không phải của implementer.

- [ ] **Step 3: Test đối chiếu**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { LESSONS, loadJvmOutput, loadLessonSource } from '../../src/lessons'

describe('đối chiếu JVM thật — output simulator khớp output Kotlin trên JVM', () => {
  for (const l of LESSONS) {
    it(`${l.id}`, () => {
      const mô = runSource(loadLessonSource(l.id)).output
      expect(mô).toEqual(loadJvmOutput(l.id))
    })
  }

  it('mọi lesson đều có fixture JVM', () => {
    // Canh hạ tầng: thiếu file thì vòng lặp trên vẫn chạy nhưng không kiểm gì.
    for (const l of LESSONS) {
      expect(() => loadJvmOutput(l.id), `${l.id} thiếu expected-jvm-output.txt`).not.toThrow()
    }
  })
})
```

- [ ] **Step 4: Red-check**

1. Sửa một ký tự trong `src/lessons/suspend/expected-jvm-output.txt` → test `suspend` phải đỏ. Khôi phục.
2. Xoá `src/lessons/dispatcher/expected-jvm-output.txt` → test "mọi lesson đều có fixture" phải đỏ. Khôi phục.
3. Xác nhận `npm test` chạy được khi NGẮT MẠNG (test chỉ đọc file, không gọi API). Nếu không chạy được thì test đang gọi mạng — sửa.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-jvm-output.ts package.json src/lessons/*/expected-jvm-output.txt src/lessons/index.ts tests/lessons/jvm-parity.test.ts
git commit -m "test(lessons): neo 9 lesson vào output JVM thật từ Kotlin playground"
```

---

### Task 13: `narrate()` — Event thành câu tiếng Việt

Spec §4.5: `narrate(event, worldState)` là hàm THUẦN, sinh câu tiếng Việt từ dữ liệu có cấu trúc. Vì thuần nên test được, và vì suy từ trace nên **case do user tự viết cũng có diễn giải mà không ai phải viết tay** — đó là điều bản HTML cũ không làm được (nó có mảng `steps[]` viết tay cho từng kịch bản).

`WorldState` đã đủ dữ liệu: `JobView` mang `parentId`, `name`, `builder`, `dispatcher`, `isSupervisor`, `cause`, `state`.

**Files:**
- Create: `src/engine/trace/label.ts`
- Create: `src/engine/narrate/narrate.ts`
- Create: `src/engine/narrate/narrateTrace.ts`
- Modify: `src/ui/graph/toReactFlow.ts` (dùng chung `jobLabel`)
- Modify: `src/ui/graph/nodes/JobNode.tsx`, `src/ui/graph/nodes/ScopeNode.tsx` (hiện nhãn từ `jobLabel`)
- Test: `tests/engine/narrate.test.ts`, `tests/engine/label.test.ts`

**Interfaces:**
- Produces: `jobLabel(j: { id: string; builder: string; name: string | null }): string` — `name` nếu có, ngược lại `` `${builder} ${id}` ``.
- Produces: `narrate(event: Event, before: WorldState): string | null` — `null` nghĩa là event này không đáng một câu (hạ tầng).
- Produces: `narrateTrace(events: readonly Event[]): NarrationLine[]` với `NarrationLine = { index: number; seq: number; t: number; text: string }`. `index` là chỉ số trong mảng `events` — UI dùng nó để nhảy step.

- [ ] **Step 1: `jobLabel` và test**

Nhãn phải DÙNG CHUNG giữa đồ thị và diễn giải. Hiện `JobNode` hiện `data.name ?? data.builder` (`JobNode.tsx:44`) — ba node `launch` cùng hiện chữ "launch", không phân biệt được, nên câu diễn giải nhắc tới "launch" cũng không chỉ được vào đâu.

`tests/engine/label.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { jobLabel } from '../../src/engine/trace/label'

describe('jobLabel', () => {
  it('dùng CoroutineName khi có', () => {
    expect(jobLabel({ id: 'j4', builder: 'launch', name: 'worker' })).toBe('worker')
  })
  it('không có tên thì builder kèm id, để phân biệt các node cùng builder', () => {
    expect(jobLabel({ id: 'j4', builder: 'launch', name: null })).toBe('launch j4')
    expect(jobLabel({ id: 'j5', builder: 'launch', name: null })).toBe('launch j5')
  })
  it('hai job khác id thì nhãn khác nhau', () => {
    const a = jobLabel({ id: 'j1', builder: 'async', name: null })
    const b = jobLabel({ id: 'j2', builder: 'async', name: null })
    expect(a).not.toBe(b)
  })
})
```

Cài `src/engine/trace/label.ts`, rồi sửa `toReactFlow.ts`/`JobNode.tsx`/`ScopeNode.tsx` dùng nó. Thêm một ca vào test UI đang có (`tests/ui/` — tìm file test của node) khẳng định hai node `launch` trong cùng đồ thị hiện hai nhãn KHÁC nhau.

- [ ] **Step 2: Viết test cho `narrate` — trước khi cài**

`tests/engine/narrate.test.ts`. Dựng trace bằng `runSource` (không bịa event bằng tay: event bịa dễ sai schema và không chứng minh được gì về trace thật), rồi tìm event cần rồi gọi `narrate` với world fold tới NGAY TRƯỚC nó.

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'
import { narrate } from '../../src/engine/narrate/narrate'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'
import type { Event } from '../../src/engine/trace/events'

const chạy = (src: string) => runSource(src).events

/** Câu cho event thứ i, với world ngay TRƯỚC nó. */
const câu = (events: readonly Event[], i: number): string | null =>
  narrate(events[i]!, foldTrace(events, i))

const tìm = (events: readonly Event[], k: Event['k'], f: (e: never) => boolean = () => true): number =>
  events.findIndex(e => e.k === k && f(e as never))

describe('narrate — mỗi event một câu', () => {
  it('FAILURE_PROPAGATED không bị chặn: nói rõ VÌ SAO failure lan lên', () => {
    // Câu mẫu trong spec §4.5.
    const e = chạy(`fun main() = runBlocking {
    coroutineScope { launch { throw RuntimeException("boom") } }
}`)
    const i = tìm(e, 'FAILURE_PROPAGATED')
    const s = câu(e, i)!
    expect(s).toContain('bất thường')
    expect(s).toContain('lan lên')
    expect(s.toLowerCase()).not.toContain('supervisor')
  })

  it('FAILURE_PROPAGATED bị chặn: nói rõ nó DỪNG ở ranh giới supervisor', () => {
    const e = chạy(`fun main() = runBlocking {
    supervisorScope { launch { throw RuntimeException("boom") } }
}`)
    const i = tìm(e, 'FAILURE_PROPAGATED')
    const s = câu(e, i)!
    expect(s).toContain('supervisor')
    expect(s).toMatch(/dừng|chặn/i)
  })

  it('hai ca trên cho ra câu KHÁC NHAU', () => {
    // Nếu narrate bỏ qua `blockedBySupervisor` thì cả hai ca trên vẫn có thể
    // xanh với một câu chung chung. Ca này bắt đúng chỗ đó.
    const a = chạy(`fun main() = runBlocking { coroutineScope { launch { throw RuntimeException("x") } } }`)
    const b = chạy(`fun main() = runBlocking { supervisorScope { launch { throw RuntimeException("x") } } }`)
    expect(câu(a, tìm(a, 'FAILURE_PROPAGATED'))).not.toBe(câu(b, tìm(b, 'FAILURE_PROPAGATED')))
  })

  it('COROUTINE_SUSPENDED vì delay: nói rõ thread ĐƯỢC TRẢ VỀ, không bị chặn', () => {
    const e = chạy(`fun main() = runBlocking { delay(100) }`)
    const s = câu(e, tìm(e, 'COROUTINE_SUSPENDED'))!
    expect(s).toMatch(/trả|nhả/i)
    expect(s).toContain('thread')
  })

  it('CANCEL_REQUESTED từ user khác với cancel lan xuống từ cha', () => {
    const e = chạy(`fun main() = runBlocking {
    val j = launch { launch { delay(1000) }; delay(1000) }
    delay(10)
    j.cancel()
    delay(50)
}`)
    const các = e.map((_, i) => i).filter(i => e[i]!.k === 'CANCEL_REQUESTED')
    expect(các.length).toBeGreaterThanOrEqual(2)
    const câuUser = câu(e, các[0]!)!
    const câuLan = câu(e, các[1]!)!
    expect(câuUser).not.toBe(câuLan)
    expect(câuUser.toLowerCase()).toMatch(/người dùng|cancel\(\)/)
  })

  it('gọi tên job bằng jobLabel, khớp nhãn trên đồ thị', () => {
    const e = chạy(`fun main() = runBlocking {
    launch(CoroutineName("thợ")) { delay(10) }
    delay(50)
}`)
    const i = tìm(e, 'COROUTINE_STARTED', (x: { id: string }) => x.id !== 'j1')
    expect(câu(e, i)).toContain('thợ')
  })

  it('event hạ tầng trả null, không sinh câu rác', () => {
    const e = chạy(`fun main() = runBlocking { delay(10) }`)
    const i = tìm(e, 'THREAD_STATE')
    expect(câu(e, i)).toBeNull()
  })

  it('là hàm THUẦN: gọi hai lần cho cùng kết quả, không đụng vào world', () => {
    const e = chạy(`fun main() = runBlocking { coroutineScope { launch { throw RuntimeException("x") } } }`)
    const i = tìm(e, 'FAILURE_PROPAGATED')
    const w = foldTrace(e, i)
    const trước = JSON.stringify([...w.jobs.entries()])
    const s1 = narrate(e[i]!, w)
    const s2 = narrate(e[i]!, w)
    expect(s1).toBe(s2)
    expect(JSON.stringify([...w.jobs.entries()])).toBe(trước)
  })

  it('mọi kind event có thật trong trace của 9 lesson đều được xử lý hoặc trả null có chủ đích', () => {
    // Canh chống bỏ sót: nếu Task sau thêm kind mới mà quên narrate, ca này đỏ.
    const e = chạy(`fun main() = runBlocking {
    val d = async(Dispatchers.IO) { delay(10); 1 }
    d.await()
    supervisorScope { launch { throw RuntimeException("x") } }
    println("xong")
}`)
    for (let i = 0; i < e.length; i++) {
      const s = câu(e, i)
      // null hợp lệ; chuỗi rỗng hoặc chứa "undefined" thì không.
      if (s !== null) {
        expect(s.length, `event ${e[i]!.k} cho câu rỗng`).toBeGreaterThan(0)
        expect(s, `event ${e[i]!.k} lọt undefined vào câu`).not.toContain('undefined')
      }
    }
  })
})

describe('narrateTrace', () => {
  it('trả về đúng những event có câu, kèm index để nhảy step', () => {
    const e = chạy(`fun main() = runBlocking { println("a") }`)
    const dòng = narrateTrace(e)
    expect(dòng.length).toBeGreaterThan(0)
    for (const d of dòng) {
      expect(e[d.index]).toBeDefined()
      expect(d.seq).toBe(e[d.index]!.seq)
      expect(narrate(e[d.index]!, foldTrace(e, d.index))).toBe(d.text)
    }
  })

  it('index tăng dần và không trùng', () => {
    const e = chạy(`fun main() = runBlocking { launch { delay(10) }; delay(50) }`)
    const idx = narrateTrace(e).map(d => d.index)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(new Set(idx).size).toBe(idx.length)
  })

  it('một lượt duyệt: không gọi foldTrace lại từ đầu cho từng event', () => {
    // O(N²) ở 16k event từng đo được 3,9 giây ở M2. Canh bằng thời gian là
    // giòn, nên canh bằng HÀNH VI: chạy trên trace dài và đòi nó xong nhanh
    // hơn nhiều lần so với cách fold lặp.
    const src = `fun main() = runBlocking {
    var i = 0
    while (i < 200) { launch { delay(1) }; i = i + 1 }
    delay(500)
}`
    const e = chạy(src)
    expect(e.length).toBeGreaterThan(1000)
    const t0 = performance.now()
    narrateTrace(e)
    const nhanh = performance.now() - t0
    const t1 = performance.now()
    e.forEach((_, i) => { if (i % 1 === 0) foldTrace(e, i) })
    const chậm = performance.now() - t1
    expect(nhanh).toBeLessThan(chậm / 5)
  })
})
```

- [ ] **Step 3: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/narrate.test.ts tests/engine/label.test.ts`
Kỳ vọng: FAIL (module chưa tồn tại).

- [ ] **Step 4: Cài `narrate`**

`src/engine/narrate/narrate.ts` — một `switch` theo `event.k`. Yêu cầu về nội dung câu:

| Event | Câu phải nói rõ |
|---|---|
| `COROUTINE_CREATED` | ai được tạo, dưới cha nào (hoặc "gốc, không cha"), builder gì |
| `COROUTINE_STARTED` | ai bắt đầu chạy, trên thread nào |
| `COROUTINE_SUSPENDED` | ai suspend, vì lý do gì, và **thread được trả về pool** |
| `COROUTINE_RESUMED` | ai resume, trên thread nào, **chạy tiếp từ chỗ đã dừng** |
| `JOB_STATE` | chỉ sinh câu cho `->Cancelling`, `->Cancelled`, `->Completed`; các bước khác trả null |
| `EXCEPTION_THROWN` | ai ném, kiểu gì, message gì |
| `EXCEPTION_CAUGHT` | ai bắt được, kiểu gì — và **exception bị bắt thì KHÔNG thành failure** |
| `FAILURE_PROPAGATED` | ai fail, lan lên ai, và **vì sao** (cha là supervisor hay không) |
| `CANCEL_REQUESTED` | phân biệt `from === 'user'` với cancel lan xuống từ cha |
| `HANDLER_RECEIVED` | handler nào nhận, exception gì |
| `DISPATCH` | ai đổi sang dispatcher nào, thread nào |
| `PRINTLN` | ai in, in gì |
| `THREAD_STATE` | `null` |
| Flow (`FLOW_*`) | `null` ở M3 — M4 sẽ viết |

Dùng `jobLabel` cho mọi lần gọi tên job. Với `COROUTINE_CREATED`, job chưa có trong `before` nên dựng nhãn từ chính event.

Viết câu như đang giảng bài, không như đang đọc log: mỗi câu nói được VÌ SAO, không chỉ CÁI GÌ. Câu mẫu trong spec §4.5:

> "B kết thúc bất thường. Vì P là Job thường (không phải supervisor), failure lan lên P."

- [ ] **Step 5: Cài `narrateTrace`**

Một lượt duyệt, giữ một `WorldState` cuộn dần. Vì `foldTrace` là hàm thuần dựng lại từ đầu, ở đây cần một biến thể áp DẦN từng event. Cách rẻ nhất mà không nhân đôi logic: tách phần thân vòng lặp của `foldTrace` thành `applyEvent(w, e)` được export, rồi `foldTrace` và `narrateTrace` cùng gọi nó. KHÔNG chép logic fold sang file thứ hai — hai bản fold lệch nhau là lỗi không ai phát hiện được cho tới khi diễn giải nói một đằng đồ thị vẽ một nẻo.

```ts
export function narrateTrace(events: readonly Event[]): NarrationLine[] {
  const out: NarrationLine[] = []
  const w = emptyWorld()
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const text = narrate(e, w)          // world TRƯỚC khi áp e
    if (text !== null) out.push({ index: i, seq: e.seq, t: e.t, text })
    applyEvent(w, e)
  }
  return out
}
```

- [ ] **Step 6: Chạy đủ, red-check**

Red-check:
1. Bỏ nhánh `blockedBySupervisor` (một câu chung cho cả hai) → ca "hai ca trên cho ra câu KHÁC NHAU" phải đỏ.
2. Trong `narrateTrace`, đổi `narrate(e, w)` thành gọi SAU `applyEvent` → ca so `narrate(...)` với `d.text` trong `narrateTrace` phải đỏ.
3. Cho `narrate` trả `''` thay vì `null` cho `THREAD_STATE` → ca "event hạ tầng trả null" phải đỏ.

- [ ] **Step 7: Commit**

```bash
git add src/engine/trace/label.ts src/engine/narrate src/engine/trace/world.ts src/ui/graph tests/engine/narrate.test.ts tests/engine/label.test.ts tests/ui
git commit -m "feat(narrate): sinh diễn giải tiếng Việt từ trace, dùng chung nhãn với đồ thị"
```

---

### Task 14: NarrationPanel — nối diễn giải vào UI

Panel hiện câu của step đang xem, kèm lịch sử các câu trước đó, bấm được để nhảy tới step tương ứng. Đây là thứ biến trace thành bài giảng.

**Files:**
- Create: `src/ui/narration/NarrationPanel.tsx`, `src/ui/narration/narration.css`
- Modify: `src/state/selectors.ts` (selector `narrationLines`, memo theo `compiled`)
- Modify: `src/ui/App.tsx` (đặt panel vào cột phải)
- Test: `tests/ui/narration.test.tsx`, `tests/ui/narration-wiring.test.tsx`

**Interfaces:**
- Consumes: `narrateTrace` (Task 13), `useLabStore` từ `src/state/store.ts` — các trường/action THẬT là `compiled`, `stepIndex`, `setStep(n)`, `loadLesson(id)`, `setSource(src)`, `lessonId`. Không có `setStepIndex`.
- Produces: `<NarrationPanel lines={...} stepIndex={...} onJump={...} />` — component thuần, không tự đọc store, theo đúng khuôn `LessonNav` đang dùng.

- [ ] **Step 1: Selector có memo**

Trong `src/state/selectors.ts`, thêm selector trả `NarrationLine[]` cho trace hiện tại, memo theo tham chiếu `compiled` (dùng đúng cơ chế memo đã có ở `src/state/memo.ts`). Lý do memo là ĐỘ ỔN ĐỊNH THAM CHIẾU, không phải tốc độ — `narrateTrace` chạy một lượt là rẻ, nhưng mảng mới mỗi lần render sẽ làm panel render lại vô ích.

- [ ] **Step 2: Test component (đỏ trước)**

`tests/ui/narration.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NarrationPanel } from '../../src/ui/narration/NarrationPanel'

const dòng = [
  { index: 2, seq: 2, t: 0, text: 'câu một' },
  { index: 5, seq: 5, t: 10, text: 'câu hai' },
  { index: 9, seq: 9, t: 20, text: 'câu ba' },
]

describe('NarrationPanel', () => {
  it('đánh dấu câu ứng với step hiện tại', () => {
    render(<NarrationPanel lines={dòng} stepIndex={6} onJump={() => {}} />)
    // step 6 nằm sau dòng index 5 và trước index 9 => câu hiện tại là "câu hai".
    expect(screen.getByTestId('narration-current')).toHaveTextContent('câu hai')
  })

  it('step 0 chưa có câu nào thì hiện lời nhắc, không hiện câu rỗng', () => {
    render(<NarrationPanel lines={dòng} stepIndex={0} onJump={() => {}} />)
    expect(screen.queryByTestId('narration-current')).toBeNull()
    expect(screen.getByTestId('narration-empty')).toBeInTheDocument()
  })

  it('step cuối thì câu hiện tại là câu cuối cùng', () => {
    render(<NarrationPanel lines={dòng} stepIndex={100} onJump={() => {}} />)
    expect(screen.getByTestId('narration-current')).toHaveTextContent('câu ba')
  })

  it('bấm một câu trong lịch sử thì nhảy tới step của nó', async () => {
    const onJump = vi.fn()
    render(<NarrationPanel lines={dòng} stepIndex={100} onJump={onJump} />)
    await userEvent.click(screen.getByText('câu một'))
    // +1 vì stepIndex là "đã áp dụng bao nhiêu event", còn index là vị trí event.
    expect(onJump).toHaveBeenCalledWith(3)
  })

  it('hiện lịch sử theo đúng thứ tự thời gian, không đảo ngược', () => {
    render(<NarrationPanel lines={dòng} stepIndex={100} onJump={() => {}} />)
    const các = screen.getAllByTestId('narration-line').map(n => n.textContent)
    expect(các.join('|')).toContain('câu một')
    expect(các.findIndex(t => t?.includes('câu một')))
      .toBeLessThan(các.findIndex(t => t?.includes('câu ba')))
  })

  it('danh sách rỗng không làm vỡ', () => {
    render(<NarrationPanel lines={[]} stepIndex={0} onJump={() => {}} />)
    expect(screen.getByTestId('narration-empty')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Test nối dây (đỏ trước)**

`tests/ui/narration-wiring.test.tsx` — dựng `App` thật với store thật, theo đúng khuôn `tests/ui/timeline-wiring.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'

describe('nối dây App -> NarrationPanel', () => {
  const nạp = (id: string) => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource(id)!)
  }

  it('tua tới hai step khác nhau thì câu hiện tại KHÁC nhau', async () => {
    nạp('supervisor')
    render(<App />)
    const tổng = useLabStore.getState().compiled.events.length
    expect(tổng, 'fixture cần đủ dài để hai step rơi vào hai câu khác nhau').toBeGreaterThan(20)

    const range = screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement

    fireEvent.change(range, { target: { value: String(Math.floor(tổng / 4)) } })
    await waitFor(() => expect(screen.getByTestId('narration-current')).toBeInTheDocument())
    const sớm = screen.getByTestId('narration-current').textContent ?? ''

    fireEvent.change(range, { target: { value: String(tổng) } })
    await waitFor(() => expect(screen.getByTestId('narration-current')).toBeInTheDocument())
    const muộn = screen.getByTestId('narration-current').textContent ?? ''

    // Bất-vô-nghĩa TRƯỚC khi so sánh: hai chuỗi rỗng cũng "khác nhau" theo
    // nghĩa nào đó, và một panel chưa render gì cả sẽ làm mọi so sánh vô giá
    // trị. M2 từng có test so `[]` với `[]` và xanh suốt.
    expect(sớm.length).toBeGreaterThan(0)
    expect(muộn.length).toBeGreaterThan(0)
    expect(sớm).not.toBe(muộn)
  })

  it('bấm một câu trong lịch sử lái stepIndex THẬT của store', async () => {
    nạp('supervisor')
    render(<App />)
    const tổng = useLabStore.getState().compiled.events.length
    fireEvent.change(
      screen.getByLabelText('Thanh kéo dòng thời gian'), { target: { value: String(tổng) } })
    await waitFor(() => {
      expect(screen.getAllByTestId('narration-line').length).toBeGreaterThan(2)
    })

    const trước = useLabStore.getState().stepIndex
    fireEvent.click(screen.getAllByTestId('narration-line')[0]!)
    const sau = useLabStore.getState().stepIndex
    expect(sau).toBeLessThan(trước)
    expect(sau).toBeGreaterThan(0)
  })

  it('trang trắng không có trace thì panel hiện lời nhắc, không vỡ', async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource('fun main() = runBlocking {\n}\n')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('narration-empty')).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Cài component và nối vào App**

Component thuần, không đọc store. Câu hiện tại = dòng cuối cùng có `index < stepIndex`. Lịch sử = mọi dòng có `index < stepIndex`, thứ tự thời gian, tự cuộn xuống dòng hiện tại. Mỗi dòng là `<button>` (bấm được bằng bàn phím), `data-testid="narration-line"`, dòng hiện tại thêm `data-testid="narration-current"`.

Trong `App.tsx`, cột phải hiện đang gộp `DiagnosticsPanel` + `ConsolePanel` trong một `Panel`. Thêm `NarrationPanel` thành `Panel` RIÊNG, đặt TRÊN cùng của cột phải — nó là nội dung người học đọc nhiều nhất.

- [ ] **Step 5: Chạy đủ 4 lệnh, red-check**

Red-check:
1. Đổi "dòng cuối cùng có `index < stepIndex`" thành "dòng đầu tiên" → ca "step cuối thì câu hiện tại là câu cuối" phải đỏ.
2. Bỏ `onJump` khỏi nút → ca "bấm một câu" phải đỏ.
3. Bỏ memo ở selector → không test nào đỏ (đúng, memo là chuyện tham chiếu). Ghi nhận điều này thay vì bịa ra test giả canh nó.

- [ ] **Step 6: Commit**

```bash
git add src/ui/narration src/ui/App.tsx src/state/selectors.ts tests/ui/narration.test.tsx tests/ui/narration-wiring.test.tsx
git commit -m "feat(ui): NarrationPanel — diễn giải theo step, bấm để nhảy"
```

---

### Task 15: `mental-model.md` cho 9 lesson và chỗ hiển thị

Diễn giải tự động nói được CHUYỆN GÌ ĐANG XẢY RA. Nó không nói được VÌ SAO NGƯỜI TA THIẾT KẾ NHƯ VẬY, hay MÔ HÌNH TƯ DUY nào giúp nhớ. Spec §4.5 gọi đó là phần "mental model" viết tay ở mức CẢ BÀI — phần tri thức simulator không tự sinh ra được.

Nguồn: `docs/reference/legacy-scenarios.md`, các trường `desc`, `concept`, và các bước `steps[]` của kịch bản tương ứng. Nhiệm vụ là **bảo toàn tri thức đó**, viết lại thành văn liền mạch — không phải nghĩ ra nội dung mới, cũng không phải chép nguyên si.

**Files:**
- Modify: `src/lessons/*/mental-model.md` × 9 (thay nội dung tạm)
- Create: `src/ui/lessons/markdown.ts` (bộ dựng markdown tối giản)
- Create: `src/ui/lessons/MentalModel.tsx`
- Modify: `src/lessons/registry.ts` (nạp `mental-model.md`)
- Modify: `src/ui/App.tsx`
- Test: `tests/ui/markdown.test.ts`, `tests/lessons/mental-model.test.ts`, `tests/ui/mental-model.test.tsx`

**Interfaces:**
- Produces: `lessonMentalModel(id: string): string | null` trong `registry.ts`, nạp bằng `import.meta.glob('./*/mental-model.md', { query: '?raw', import: 'default', eager: true })` — cùng cơ chế đã dùng cho `main.kt`, nên không thể trôi lệch.
- Produces: `renderMarkdown(src: string): ReactNode[]` — dựng phần tử React, **không dùng `dangerouslySetInnerHTML`**.

- [ ] **Step 1: Chốt subset markdown**

Không thêm thư viện markdown (Global Constraints cấm thêm dependency). Viết bộ dựng tối giản, hỗ trợ đúng những gì `mental-model.md` được phép dùng:

- `## Tiêu đề` → `<h3>`
- đoạn văn ngăn cách bằng dòng trống → `<p>`
- `- mục` → `<ul><li>`
- `` `mã` `` trong dòng → `<code>`
- `**đậm**` → `<strong>`
- khối ```` ```kotlin … ``` ```` → `<pre><code>`

Mọi thứ khác hiện nguyên văn. Không hỗ trợ HTML thô, không hỗ trợ link — nội dung là của chính dự án, không phải của user, nên đây là giới hạn phạm vi chứ không phải biện pháp an ninh; nhưng vì dựng bằng phần tử React nên HTML thô trong file cũng không thể chạy được.

`tests/ui/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderMarkdown } from '../../src/ui/lessons/markdown'

const dựng = (src: string) => render(<div>{renderMarkdown(src)}</div>)

describe('renderMarkdown', () => {
  it('tiêu đề, đoạn văn, danh sách', () => {
    dựng('## Ý chính\n\nĐoạn một.\n\n- mục A\n- mục B\n')
    expect(screen.getByRole('heading')).toHaveTextContent('Ý chính')
    expect(screen.getByText('Đoạn một.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('mã trong dòng và chữ đậm', () => {
    const { container } = dựng('Gọi `launch` rồi **chờ**.')
    expect(container.querySelector('code')).toHaveTextContent('launch')
    expect(container.querySelector('strong')).toHaveTextContent('chờ')
  })

  it('khối code giữ nguyên xuống dòng', () => {
    const { container } = dựng('```kotlin\nval a = 1\nval b = 2\n```')
    expect(container.querySelector('pre')?.textContent).toBe('val a = 1\nval b = 2\n')
  })

  it('KHÔNG chạy HTML thô — hiện ra dưới dạng chữ', () => {
    const { container } = dựng('<img src=x onerror=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img')
  })

  it('chuỗi rỗng không làm vỡ', () => {
    const { container } = dựng('')
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 2: Viết 9 file `mental-model.md`**

Mỗi file 150-350 từ, cấu trúc:

```markdown
## Mô hình tư duy

<2-4 đoạn: cách NGHĨ về khái niệm này. Ẩn dụ nếu có ẩn dụ tốt.>

## Vì sao Kotlin thiết kế như vậy

<1-2 đoạn: lý do, không phải mô tả.>

## Chỗ hay sai

- <sai lầm phổ biến 1>
- <sai lầm phổ biến 2>

## Nhìn gì trên đồ thị

<1 đoạn: chỉ cụ thể người học nên nhìn node nào, cạnh nào, ở step nào.>
```

Lấy nội dung từ `docs/reference/legacy-scenarios.md`. Mục "Chỗ hay sai" là chỗ giá trị nhất — bản HTML cũ có sẵn nhiều ý này trong `desc` và `steps`.

- [ ] **Step 3: Test nội dung mental model**

`tests/lessons/mental-model.test.ts` — canh chính cái dễ hỏng nhất: file thiếu, file còn nội dung tạm, file trống rỗng.

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LESSONS } from '../../src/lessons'

describe('mental-model.md', () => {
  for (const l of LESSONS) {
    it(`${l.id}: có nội dung thật, đủ bốn mục`, () => {
      const s = readFileSync(join('src/lessons', l.id, 'mental-model.md'), 'utf8')
      expect(s).not.toContain('TODO')
      expect(s.length).toBeGreaterThan(400)
      for (const mục of ['## Mô hình tư duy', '## Vì sao', '## Chỗ hay sai', '## Nhìn gì trên đồ thị']) {
        expect(s, `${l.id} thiếu mục ${mục}`).toContain(mục)
      }
    })
  }
})
```

- [ ] **Step 4: Nạp và hiển thị**

Thêm `lessonMentalModel` vào `registry.ts`. Tạo `MentalModel.tsx` — component thuần nhận `markdown: string | null`, trả null nếu không có. Đặt trong `App.tsx` ngay dưới `LessonNav` ở cột trái, có thể thu gọn (`<details>`), mặc định MỞ khi vừa nạp lesson.

`tests/ui/mental-model.test.tsx`: hiện nội dung khi có lesson; không hiện gì khi ở trang trắng; đổi lesson thì nội dung đổi (so hai chuỗi KHÁC RỖNG với nhau, không so với chính nó).

- [ ] **Step 5: Chạy đủ 4 lệnh, red-check**

Red-check:
1. Thay nội dung `src/lessons/suspend/mental-model.md` bằng `TODO` → test mental-model phải đỏ. Khôi phục.
2. Trong `renderMarkdown`, đổi sang `dangerouslySetInnerHTML` → ca "KHÔNG chạy HTML thô" phải đỏ. Khôi phục.
3. Xoá một mục `## Chỗ hay sai` khỏi một file → test phải đỏ, và phải nói rõ lesson nào. Khôi phục.

- [ ] **Step 6: Commit**

```bash
git add src/lessons/*/mental-model.md src/lessons/registry.ts src/ui/lessons src/ui/App.tsx tests/ui/markdown.test.ts tests/ui/mental-model.test.tsx tests/lessons/mental-model.test.ts
git commit -m "feat(lessons): mental model viết tay cho cả 9 bài, hiển thị trong app"
```

---

### Task 16: LessonNav — thứ tự, đánh dấu đã học, ghi nhớ qua lần mở sau

`LessonNav` hiện đã liệt kê lesson theo `order` và đánh dấu bài đang mở. Còn thiếu phần "lộ trình có thứ tự, đánh dấu đã học" mà spec §6 yêu cầu.

Trong repo **chưa có `localStorage` ở bất kỳ đâu** — hạ tầng này dựng mới hoàn toàn. Giữ nó nhỏ và thuần: logic tiến độ là hàm thuần trên một interface lưu trữ, nên test được mà không phụ thuộc quirk của `localStorage` trong jsdom.

Định nghĩa "đã học": người học đã **tua tới cuối** trace của bài đó ít nhất một lần. Không phải "đã bấm vào" (quá dễ), không phải quiz (spec đã loại quiz khỏi phạm vi).

**Files:**
- Create: `src/state/progress.ts`
- Modify: `src/state/store.ts` (state `learned`, action `markLearned`)
- Modify: `src/ui/lessons/LessonNav.tsx`, `src/ui/lessons/lesson-nav.css`
- Test: `tests/state/progress.test.ts`, `tests/ui/lesson-nav.test.tsx`, `tests/ui/lesson-progress-wiring.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface KhoLưu { get(k: string): string | null; set(k: string, v: string): void }
export const KHOÁ = 'kcl.progress.v1'
export function đọcTiếnĐộ(kho: KhoLưu): string[]
export function ghiTiếnĐộ(kho: KhoLưu, ids: readonly string[]): void
export function khoTrìnhDuyệt(): KhoLưu     // bọc localStorage, an toàn khi bị chặn
```
Khoá có hậu tố `v1` để lần đổi schema sau không đọc nhầm dữ liệu cũ (spec §8 yêu cầu versioning).

- [ ] **Step 1: Test cho `progress.ts` (đỏ trước)**

```ts
import { describe, expect, it } from 'vitest'
import { KHOÁ, đọcTiếnĐộ, ghiTiếnĐộ, type KhoLưu } from '../../src/state/progress'

const khoGiả = (đầu: Record<string, string> = {}): KhoLưu & { data: Record<string, string> } => ({
  data: { ...đầu },
  get(k) { return this.data[k] ?? null },
  set(k, v) { this.data[k] = v },
})

describe('tiến độ học', () => {
  it('kho rỗng thì chưa học bài nào', () => {
    expect(đọcTiếnĐộ(khoGiả())).toEqual([])
  })

  it('ghi rồi đọc lại được', () => {
    const k = khoGiả()
    ghiTiếnĐộ(k, ['suspend', 'jobtree'])
    expect(đọcTiếnĐộ(k)).toEqual(['suspend', 'jobtree'])
  })

  it('dữ liệu hỏng trong kho KHÔNG làm vỡ app — trả rỗng', () => {
    // localStorage là dữ liệu ngoài tầm kiểm soát: người dùng sửa tay, phiên
    // bản cũ ghi định dạng khác, extension ghi đè. Vỡ ở đây là trắng màn hình.
    expect(đọcTiếnĐộ(khoGiả({ [KHOÁ]: 'không phải json' }))).toEqual([])
    expect(đọcTiếnĐộ(khoGiả({ [KHOÁ]: '{"không":"phải mảng"}' }))).toEqual([])
    expect(đọcTiếnĐộ(khoGiả({ [KHOÁ]: '[1,2,3]' }))).toEqual([])
  })

  it('lọc phần tử không phải chuỗi thay vì trả cả mảng bẩn', () => {
    expect(đọcTiếnĐộ(khoGiả({ [KHOÁ]: '["suspend",5,null,"jobtree"]' }))).toEqual(['suspend', 'jobtree'])
  })

  it('ghi hai lần không nhân đôi id', () => {
    const k = khoGiả()
    ghiTiếnĐộ(k, ['suspend'])
    ghiTiếnĐộ(k, ['suspend', 'suspend', 'jobtree'])
    expect(đọcTiếnĐộ(k)).toEqual(['suspend', 'jobtree'])
  })

  it('kho ném lỗi khi ghi (chế độ riêng tư) thì nuốt lỗi, không làm vỡ', () => {
    const kho: KhoLưu = { get: () => null, set: () => { throw new Error('bị chặn') } }
    expect(() => ghiTiếnĐộ(kho, ['suspend'])).not.toThrow()
  })
})
```

- [ ] **Step 2: Cài `progress.ts`, nối vào store**

`store.ts` thêm `learned: string[]` (khởi tạo bằng `đọcTiếnĐộ(khoTrìnhDuyệt())`) và `markLearned(id: string)` (thêm vào mảng nếu chưa có, rồi `ghiTiếnĐộ`).

Chỗ gọi `markLearned`: khi `stepIndex` đạt `compiled.events.length` (và trace không rỗng) trong lúc đang mở một lesson. Đặt bên trong action `setStep` của store (`src/state/store.ts:41`) — KHÔNG đặt trong `useEffect` của component, vì tua bằng bàn phím, bằng nút play, và bằng kéo thanh trượt là ba đường khác nhau cùng gọi vào store, còn component thì có nhiều.

- [ ] **Step 3: Test nối dây (đỏ trước)**

`tests/ui/lesson-progress-wiring.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { KHOÁ, đọcTiếnĐộ, khoTrìnhDuyệt } from '../../src/state/progress'

/** Nhãn của một mục nav, dùng để đọc trạng thái "đã học" qua aria chứ không qua màu. */
const mụcNav = (title: string) => screen.getByRole('button', { name: new RegExp(title) })

describe('nối dây tiến độ học', () => {
  beforeEach(() => {
    // Không xoá thì các ca rò rỉ trạng thái sang nhau và một ca có thể xanh
    // nhờ ca chạy trước — kiểu xanh giả khó thấy nhất.
    localStorage.clear()
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null, learned: [] })
  })

  it('tua tới cuối trace thì lesson được đánh dấu đã học và ghi vào kho', async () => {
    useLabStore.getState().loadLesson('suspend')
    render(<App />)
    const tổng = useLabStore.getState().compiled.events.length
    expect(tổng, 'lesson phải có trace thì test mới có nghĩa').toBeGreaterThan(0)

    useLabStore.getState().setStep(tổng)

    await waitFor(() => {
      expect(useLabStore.getState().learned).toContain('suspend')
    })
    expect(đọcTiếnĐộ(khoTrìnhDuyệt())).toContain('suspend')
    expect(localStorage.getItem(KHOÁ)).toBeTruthy()
  })

  it('tua CHƯA tới cuối thì CHƯA đánh dấu', () => {
    // Cặp đối chứng. Thiếu ca này thì cài đặt "đánh dấu ngay khi mở bài" vẫn
    // làm ca trên xanh.
    useLabStore.getState().loadLesson('suspend')
    render(<App />)
    const tổng = useLabStore.getState().compiled.events.length
    useLabStore.getState().setStep(Math.floor(tổng / 2))
    expect(useLabStore.getState().learned).not.toContain('suspend')
    expect(đọcTiếnĐộ(khoTrìnhDuyệt())).not.toContain('suspend')
  })

  it('chỉ đánh dấu ĐÚNG bài đang mở, không đánh dấu bài khác', () => {
    useLabStore.getState().loadLesson('suspend')
    render(<App />)
    useLabStore.getState().setStep(useLabStore.getState().compiled.events.length)
    expect(useLabStore.getState().learned).toEqual(['suspend'])
  })

  it('trang trắng (không phải lesson) tua tới cuối thì không ghi gì', () => {
    useLabStore.getState().setSource('fun main() = runBlocking {\n    println("x")\n}\n')
    render(<App />)
    useLabStore.getState().setStep(useLabStore.getState().compiled.events.length)
    expect(useLabStore.getState().learned).toEqual([])
  })

  it('mở lại app đọc được tiến độ đã lưu', async () => {
    localStorage.setItem(KHOÁ, JSON.stringify(['jobtree']))
    // Store đọc kho lúc khởi tạo module, nên nạp lại giá trị tường minh —
    // đây chính là đường mà lần mở app sau đi qua.
    useLabStore.setState({ learned: đọcTiếnĐộ(khoTrìnhDuyệt()) })
    render(<App />)
    await waitFor(() => {
      expect(mụcNav('Job Tree')).toHaveAttribute('data-learned', 'true')
    })
  })
})
```

`LessonNav` phải đặt `data-learned="true"|"false"` trên nút của mỗi bài (và một `aria-label` nói rõ "đã học"), để trạng thái đọc được mà không phụ thuộc màu sắc.

- [ ] **Step 4: LessonNav hiện tiến độ**

Thêm vào mỗi mục: số thứ tự (`order`), và dấu đã học (`aria-label` rõ ràng, không chỉ màu — người dùng bàn phím và trình đọc màn hình cũng phải biết). Thêm dòng tổng "đã học N/9".

`tests/ui/lesson-nav.test.tsx`: hiện đủ 9 bài theo đúng thứ tự `order`; bài đã học có dấu; bài chưa học không có; đếm N/9 đúng.

- [ ] **Step 5: Chạy đủ 4 lệnh, red-check**

Red-check:
1. Đổi điều kiện đánh dấu thành "khi nạp lesson" → ca "tua chưa tới cuối thì CHƯA đánh dấu" phải đỏ.
2. Bỏ `try/catch` quanh `JSON.parse` → ca "dữ liệu hỏng" phải đỏ.
3. Bỏ `ghiTiếnĐộ` trong `markLearned` (chỉ đổi state trong bộ nhớ) → ca "mở lại app đọc được tiến độ" phải đỏ.

- [ ] **Step 6: Commit**

```bash
git add src/state/progress.ts src/state/store.ts src/ui/lessons tests/state/progress.test.ts tests/ui/lesson-nav.test.tsx tests/ui/lesson-progress-wiring.test.tsx
git commit -m "feat(ui): lộ trình bài học có đánh dấu đã học, lưu qua localStorage"
```

---

### Task 17: DiagnosticsPanel — phân biệt lỗi từ tầng nào

`DiagnosticsPanel` đã báo lỗi kèm số dòng và nhảy được tới dòng đó. Còn một chỗ hụt: `Diagnostic.severity` chỉ có đúng một giá trị `'error'` và không có trường nào cho biết lỗi đến từ đâu. Ba tầng sinh lỗi rất khác nhau về cách người học phải phản ứng:

- **lex** — ký tự không nhận diện được. Đã đo: `coroutineContext[Job]` cho ra `LexError` KHÔNG có `hint`, hình dạng khác hẳn `Diagnostic` của validator.
- **parse** — cú pháp sai. Sửa cú pháp.
- **validate** — cú pháp đúng, nhưng construct nằm ngoài subset. Có `hint` gợi ý cách viết khác.

Người học gặp lỗi tầng ba mà tưởng mình gõ sai cú pháp sẽ đi sửa nhầm chỗ.

**Files:**
- Modify: `src/engine/validator/diagnostics.ts` (thêm `source` vào `Diagnostic`)
- Modify: `src/engine/run.ts` (gắn `source` cho lỗi lex/parse; thống nhất hình dạng)
- Modify: `src/ui/diagnostics/DiagnosticsPanel.tsx`, `src/ui/diagnostics/diagnostics.css`
- Test: `tests/engine/diagnostic-source.test.ts`, `tests/ui/diagnostics.test.tsx`

**Interfaces:**
- Produces: `Diagnostic` thêm `source: 'lex' | 'parse' | 'validate'`. Mọi lỗi trả về từ `runSource`/`runSourceSafe` đều có trường này.

- [ ] **Step 1: Test (đỏ trước)**

```ts
import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'

const d = (src: string) => runSourceSafe(src).diagnostics

describe('Diagnostic mang nguồn gốc lỗi', () => {
  it('lỗi lexer có source lex và vẫn có hint', () => {
    const r = d('fun main() = runBlocking {\n    val j = coroutineContext[Job]\n}')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.source).toBe('lex')
    expect(r[0]!.line).toBe(2)
    expect(r[0]!.hint).toBeTruthy()
  })

  it('lỗi parser có source parse', () => {
    const r = d('fun main() = runBlocking {\n    val x = \n}')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.source).toBe('parse')
  })

  it('construct chưa hỗ trợ có source validate và có hint', () => {
    const r = d('fun main() = runBlocking {\n    val c = Channel<Int>()\n}')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.source).toBe('validate')
    expect(r[0]!.hint).toBeTruthy()
  })

  it('MỌI diagnostic đều có source — không cái nào thiếu', () => {
    // Canh chống bỏ sót đường sinh lỗi. Nếu còn đường nào tạo Diagnostic mà
    // quên gắn source, ca này bắt được.
    const nguồnLỗi = [
      'fun main() = runBlocking {\n    val j = coroutineContext[Job]\n}',
      'fun main() = runBlocking {\n    val x = \n}',
      'fun main() = runBlocking {\n    Channel<Int>()\n}',
      'fun main() = runBlocking {\n    withTimeout(10) { }\n}',
      'fun main() = runBlocking {\n    val a = listOf(1, 2)\n}',
      '!!! không phải Kotlin',
    ]
    for (const src of nguồnLỗi) {
      for (const x of d(src)) {
        expect(['lex', 'parse', 'validate'], `source lạ: ${x.source}`).toContain(x.source)
      }
    }
  })
})
```

- [ ] **Step 2: Cài**

Thêm `source` vào kiểu `Diagnostic`. Trong `run.ts`, chỗ bắt `LexError` và lỗi parser, dựng `Diagnostic` đầy đủ (có `hint`, có `source`) thay vì hình dạng riêng. Hint cho lỗi lex: gợi ý về subset — ví dụ với `[`: `'Cú pháp truy cập theo chỉ số chưa được hỗ trợ. Dùng coroutineContext[Job] chưa có ở phiên bản này.'`

Mặc định `source: 'validate'` cho các diagnostic sinh từ validator.

- [ ] **Step 3: UI hiện nhãn nguồn**

Mỗi dòng lỗi thêm một chip nhỏ: `cú pháp` (lex/parse) hoặc `chưa hỗ trợ` (validate), màu khác nhau. Giữ nguyên hành vi bấm-để-nhảy-dòng đang có.

`tests/ui/diagnostics.test.tsx`: thêm ca — lỗi `validate` hiện chip "chưa hỗ trợ" kèm hint; lỗi `parse` hiện chip "cú pháp"; hai loại hiện chip KHÁC nhau (so hai chuỗi khác rỗng).

- [ ] **Step 4: Chạy đủ 4 lệnh, red-check**

Red-check:
1. Gắn cứng `source: 'validate'` cho mọi lỗi → ca "lỗi lexer có source lex" phải đỏ.
2. Bỏ chip khỏi UI → ca test UI phải đỏ.

- [ ] **Step 5: Commit**

```bash
git add src/engine/validator/diagnostics.ts src/engine/run.ts src/ui/diagnostics tests/engine/diagnostic-source.test.ts tests/ui/diagnostics.test.tsx
git commit -m "feat(diagnostics): phân biệt lỗi lex/parse/validate và hiện rõ trên panel"
```

---

### Task 18: Nghiệm thu M3

Spec §11 đặt điều kiện nghiệm thu M3: *"9 golden trace test xanh; nội dung dạy học không thua bản HTML cũ."* Vế đầu đo được thẳng. Vế sau phải biến thành thứ đo được, nếu không nó chỉ là ý kiến.

"Không thua bản HTML cũ" nghĩa là: đủ 9 bài, mỗi bài có phần giải thích viết tay, và **thêm được thứ bản cũ không có** — diễn giải sinh tự động, chạy được cho cả code do user viết, và tính đúng được neo vào JVM thật.

**Files:**
- Create: `tests/lessons/acceptance-m3.test.ts`
- Create: `tests/ui/acceptance-m3-dom.test.tsx`
- Modify: `docs/superpowers/plans/2026-08-12-m3-lessons-narrate.md` (mục "Việc còn lại sau M3")

- [ ] **Step 1: Test nghiệm thu — phần engine và lesson**

```ts
import { describe, expect, it } from 'vitest'
import { LESSONS, loadGoldenTrace, loadJvmOutput, loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'

const CHÍN = ['suspend', 'jobtree', 'exception', 'normalfail', 'supervisor',
              'launchasync', 'dispatcher', 'scopecompare', 'nestedtrap']

describe('nghiệm thu M3', () => {
  it('đủ 9 lesson, đúng thứ tự dạy của bản HTML gốc', () => {
    expect(LESSONS.map(l => l.id)).toEqual(CHÍN)
  })

  it('cả 9 lesson: parse sạch, khớp golden, khớp output JVM thật', () => {
    for (const l of LESSONS) {
      const r = runSource(loadLessonSource(l.id))
      expect(r.diagnostics, `${l.id} có diagnostic`).toEqual([])
      expect(r.output, `${l.id} lệch golden`).toEqual(loadGoldenTrace(l.id).output)
      expect(r.output, `${l.id} lệch JVM thật`).toEqual(loadJvmOutput(l.id))
    }
  })

  it('cả 9 lesson đều có diễn giải sinh tự động, không bài nào câm', () => {
    for (const l of LESSONS) {
      const dòng = narrateTrace(runSource(loadLessonSource(l.id)).events)
      expect(dòng.length, `${l.id} không sinh câu nào`).toBeGreaterThan(5)
      expect(dòng.every(d => d.text.trim().length > 0)).toBe(true)
    }
  })

  it('code do USER viết cũng có diễn giải — thứ bản HTML cũ không làm được', () => {
    // Bản cũ có mảng steps[] viết tay cho từng kịch bản. Đoạn dưới đây không
    // phải lesson nào cả.
    const r = runSource(`fun main() = runBlocking {
    val d = async(Dispatchers.IO) { delay(20); 7 }
    println(d.await())
    supervisorScope { launch { throw RuntimeException("tự viết") } }
}`)
    expect(r.diagnostics).toEqual([])
    const dòng = narrateTrace(r.events)
    expect(dòng.length).toBeGreaterThan(10)
    expect(dòng.some(d => d.text.includes('supervisor'))).toBe(true)
  })

  it('mỗi lesson có mental model viết tay và ít nhất 2 khái niệm', () => {
    for (const l of LESSONS) {
      expect(l.concepts.length, `${l.id} thiếu concepts`).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('bảng tương phản M3 — hai chương trình khác nhau một từ', () => {
  const chạy = (id: string) => runSource(loadLessonSource(id))

  it('scopecompare chứa CẢ HAI vế trong cùng một bài, và chúng khác nhau thật', () => {
    const r = chạy('scopecompare')
    const fail = r.events.filter(e => e.k === 'FAILURE_PROPAGATED')
    // Một vế bị chặn ở supervisor, một vế không. Nếu cả hai giống nhau thì
    // bài học không dạy được gì.
    expect(fail.some(e => e.blockedBySupervisor)).toBe(true)
    expect(fail.some(e => !e.blockedBySupervisor)).toBe(true)
  })

  it('normalfail và supervisor: cùng thân, khác kết cục — đo lại ở M3', () => {
    const nf = chạy('normalfail')
    const sv = chạy('supervisor')
    expect(nf.output).toHaveLength(0)
    expect(sv.output).toHaveLength(2)
    expect(nf.events.some(e => e.k === 'FAILURE_PROPAGATED' && e.blockedBySupervisor)).toBe(false)
    expect(sv.events.some(e => e.k === 'FAILURE_PROPAGATED' && e.blockedBySupervisor)).toBe(true)
  })

  it('nestedtrap: supervisor vẫn sống NHƯNG cháu vẫn chết — cái bẫy', () => {
    const r = chạy('nestedtrap')
    const fail = r.events.filter(e => e.k === 'FAILURE_PROPAGATED')
    expect(fail[0]!.blockedBySupervisor).toBe(false)
    expect(fail[fail.length - 1]!.blockedBySupervisor).toBe(true)
    expect(r.output.some(l => l.includes('A xong'))).toBe(false)
  })
})
```

- [ ] **Step 2: Test nghiệm thu — phần DOM**

`tests/ui/acceptance-m3-dom.test.tsx`: dựng `App` thật và khẳng định người học thấy được:

1. Nav liệt kê đủ 9 bài theo thứ tự.
2. Nạp một lesson → hiện mental model của ĐÚNG bài đó (so nội dung hai bài khác nhau, cả hai khác rỗng).
3. Tua timeline → câu diễn giải hiện tại ĐỔI (so hai chuỗi khác rỗng ở hai step khác nhau).
4. Tua tới cuối → bài được đánh dấu đã học.

Mỗi ca phải khẳng định giá trị KHÁC RỖNG trước khi so sánh. Đây là chỗ M2 từng có test so `[]` với `[]` và xanh suốt.

- [ ] **Step 3: Chạy đủ 4 lệnh trên toàn bộ dự án**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Ghi vào báo cáo: tổng số file test, tổng số test, và xác nhận cả bốn lệnh sạch.

- [ ] **Step 4: Kiểm chứng app chạy thật**

```bash
npm run dev &
sleep 4
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/
curl -s http://localhost:5173/ | grep -c 'id="root"'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/src/main.tsx
kill %1
```
Kỳ vọng: 200, 1, 200. Ghi kết quả thật vào báo cáo. Nếu cổng 5173 bận thì đọc cổng thật từ output của Vite.

- [ ] **Step 5: Red-check nghiệm thu**

Ba phép phá cố ý, mỗi phép phải làm ĐỎ đúng chỗ nó nhắm, rồi khôi phục:

1. Trong `src/lessons/scopecompare/main.kt`, đổi `supervisorScope` thành `coroutineScope` → "bảng tương phản" phải đỏ, VÀ golden phải đỏ, VÀ JVM parity phải đỏ. Ba tuyến phòng thủ độc lập cùng bắt được một lỗi — nếu chỉ một tuyến đỏ, hai tuyến kia đang không canh gì.
2. Trong `narrate.ts`, bỏ nhánh `FAILURE_PROPAGATED` (trả null) → "cả 9 lesson đều có diễn giải" hoặc "code user cũng có diễn giải" phải đỏ.
3. Xoá một lesson khỏi `src/lessons/` → "đủ 9 lesson" phải đỏ với thông báo đọc được.

- [ ] **Step 6: Ghi việc còn lại**

Thêm mục "## Việc còn lại sau M3" vào cuối file plan này, ghi trung thực những gì CHƯA làm được, kèm lý do — không viết lại thành thành tựu:
- các tồn đọng M1 (A1, A4, B4) nếu vẫn còn
- `joinChildren` vẫn không phân biệt được với `join` ở tầng Event
- construct trong subset §4.1 vẫn chưa hỗ trợ: `withTimeout`, `withTimeoutOrNull`, `invokeOnCompletion`, `NonCancellable`, `getCompleted`, `coroutineContext[...]`, `CoroutineExceptionHandler` (parse được nhưng không bao giờ được gọi, `HANDLER_RECEIVED` chưa bao giờ phát)
- chưa có headless browser nên `boundingBox` thật, CSS layout thật, kéo chuột thật vẫn chưa kiểm được
- bất kỳ chỗ nào lệch giữa simulator và JVM thật phát hiện ở Task 12

- [ ] **Step 7: Commit**

```bash
git add tests/lessons/acceptance-m3.test.ts tests/ui/acceptance-m3-dom.test.tsx docs/superpowers/plans/2026-08-12-m3-lessons-narrate.md
git commit -m "test: nghiệm thu M3 — 9 lesson, golden, JVM parity, diễn giải tự động"
```

---

## Bảng nghiệm thu M3

| Đo cái gì | Đạt khi |
|---|---|
| Số lesson | 9, đúng thứ tự dạy của bản HTML gốc |
| Golden trace | 9/9 khớp `expected-trace.json` |
| Đối chiếu JVM thật | 9/9 output khớp `expected-jvm-output.txt` |
| Diễn giải | mọi lesson > 5 câu; code user tự viết cũng có câu |
| Mental model | 9/9 có đủ 4 mục, không còn `TODO` |
| Lộ trình | tua hết bài thì đánh dấu đã học, còn nguyên sau khi mở lại |
| Diagnostic | mọi lỗi mang `source` ∈ {lex, parse, validate}, đều có hint |
| Bốn lệnh | `npm test`, `typecheck`, `lint`, `build` — sạch cả bốn |
| App chạy thật | `vite dev` trả 200, `#root` có mặt, `/src/main.tsx` transform được |

Ba phép phá cố ý ở Task 18 Step 5 phải đỏ đúng chỗ. Không có chúng thì bảng trên chỉ chứng minh test chạy được, không chứng minh test canh được gì.

---

## Hai task chèn thêm (viết sau khi Task 4 phát hiện engine lệch Kotlin thật)

Task 19 và Task 20 **chạy sau Task 6 và trước Task 7**, không phải cuối plan. Chúng nằm ở cuối file chỉ vì được viết thêm sau — đánh số tiếp để `scripts/task-brief` không phải đánh số lại toàn bộ. Cả hai đều đổi hình dạng trace, nên bắt buộc phải xong TRƯỚC khi Task 7 chốt golden, nếu không golden sẽ phải sinh lại hai lần và lần chốt đầu là chốt cái sai.

Cả hai được phát hiện bằng cách đối chiếu với Kotlin thật trong lúc làm Task 4, không phải bằng suy luận.

---

### Task 19: Job Active ngay khi được tạo, không phải khi bắt đầu chạy

Đo được (Task 4, đối chiếu `api.kotlinlang.org`):

```kotlin
fun main() = runBlocking {
    val job = launch { delay(10) }
    println(job.isActive)
}
```
Kotlin thật in `true`. Engine in `false`.

Nguyên nhân: `Scheduler.spawn` (`scheduler.ts:107-125`) tạo Job ở state `New` rồi đẩy vào `ready` mà không chuyển state; `New → Active` chỉ xảy ra ở lần `step()` đầu tiên (`scheduler.ts:317-320`). Vì `launch` trả về đồng bộ cho người gọi, mọi câu lệnh Kotlin đứng giữa `launch { }` và điểm suspend kế tiếp đều quan sát được state `New` — một state mà **Kotlin thật không bao giờ cho thấy** với `CoroutineStart.DEFAULT`.

Trong Kotlin, `New` chỉ tồn tại với `CoroutineStart.LAZY`, mà LAZY nằm ngoài subset §4.1. Nên với mọi thứ subset này hỗ trợ, một coroutine vừa tạo LÀ Active.

Giữ nguyên `New` trong state machine (spec §4.3 vẽ nó, và LAZY có thể vào subset sau) — chỉ đổi thời điểm rời khỏi nó.

Phân biệt hai thứ đang bị lẫn: **Active** là trạng thái VÒNG ĐỜI (job đã được lên lịch, huỷ được, join được). **COROUTINE_STARTED** là sự kiện THỰC THI (thân nó bắt đầu chạy trên một thread). Task này tách chúng ra; `COROUTINE_STARTED` vẫn ở nguyên chỗ cũ.

**Files:**
- Modify: `src/engine/runtime/scheduler.ts` (`spawn`/`spawnChildOf` chuyển Active ngay; `step()` không chuyển nữa)
- Test: `tests/engine/job-lifecycle.test.ts` (tạo mới)

**Interfaces:**
- Produces: ngay sau `COROUTINE_CREATED` của một coroutine là `JOB_STATE {from:'New', to:'Active'}` của chính nó. `COROUTINE_STARTED` vẫn phát ở lần `step()` đầu, không đổi.

- [ ] **Step 1: Đối chiếu Kotlin thật TRƯỚC khi sửa**

Chạy đoạn dưới trên JVM thật và dán nguyên output vào báo cáo:

```bash
curl -s -X POST 'https://api.kotlinlang.org/api/2.1.20/compiler/run' \
  -H 'Content-Type: application/json' -H 'Origin: https://play.kotlinlang.org' \
  --data '{"args":"","files":[{"name":"File.kt","publicId":"","text":"import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n    val job = launch { delay(10) }\n    println(job.isActive)\n    println(job.isCompleted)\n    println(job.isCancelled)\n    job.join()\n    println(job.isActive)\n    println(job.isCompleted)\n}\n"}],"confType":"java"}'
```

Nếu kết quả KHÁC `true,false,false,false,true` thì plan này sai — dừng lại và báo, đừng sửa engine theo plan.

- [ ] **Step 2: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('vòng đời Job — Active ngay khi tạo (CoroutineStart.DEFAULT)', () => {
  it('job Active ngay sau launch, trước khi thân nó chạy dòng nào', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    println(job.isActive)
    println(job.isCompleted)
    println(job.isCancelled)
    job.join()
    println(job.isActive)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['true', 'false', 'false', 'false', 'true'])
  })

  it('async cũng vậy', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(10); 1 }
    println(d.isActive)
    d.await()
    println(d.isActive)
}`)
    expect(r.output).toEqual(['true', 'false'])
  })

  it('JOB_STATE New->Active đứng NGAY SAU COROUTINE_CREATED của cùng job', () => {
    // Khẳng định về hình dạng trace, không chỉ về giá trị đọc được: nếu ai đó
    // cài bằng cách cho `isActive` nói dối (trả true khi state là New) thì hai
    // ca trên vẫn xanh còn ca này đỏ.
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const i = r.events.findIndex(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')
    const kế = r.events[i + 1]!
    expect(kế.k).toBe('JOB_STATE')
    expect(kế).toMatchObject({ from: 'New', to: 'Active' })
  })

  it('COROUTINE_STARTED vẫn phát MUỘN HƠN, ở lần chạy đầu — Active khác với đã chạy', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const active = r.events.findIndex(e => e.k === 'JOB_STATE' && e.to === 'Active' && e.id !== 'j1')
    const started = r.events.findIndex(e => e.k === 'COROUTINE_STARTED' && e.id !== 'j1')
    expect(active).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(active)
  })

  it('không có JOB_STATE nào chuyển sang Active HAI LẦN cho cùng một job', () => {
    // Canh đúng lỗi dễ mắc nhất khi sửa: thêm chuyển đổi lúc tạo mà quên bỏ
    // chuyển đổi cũ trong step().
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    launch { delay(20) }
    delay(50)
}`)
    const đếm = new Map<string, number>()
    for (const e of r.events) {
      if (e.k === 'JOB_STATE' && e.to === 'Active') đếm.set(e.id, (đếm.get(e.id) ?? 0) + 1)
    }
    for (const [id, n] of đếm) expect(n, `job ${id} vào Active ${n} lần`).toBe(1)
  })

  it('huỷ một job CHƯA từng chạy vẫn đúng: Cancelled, không kẹt ở New', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(1000); println("không in") }
    job.cancel()
    println(job.isCancelled)
    delay(50)
}`)
    expect(r.output).toEqual(['true'])
  })
})
```

- [ ] **Step 3: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/job-lifecycle.test.ts`. Ghi output thật vào báo cáo.

- [ ] **Step 4: Sửa**

Trong `spawn`/`spawnChildOf` (`scheduler.ts:107-125`): ngay sau khi phát `COROUTINE_CREATED`, gọi `job.transitionTo('Active')` và phát `JOB_STATE {from:'New', to:'Active'}`. Trong `step()` (`scheduler.ts:317-320`), bỏ phần chuyển `New→Active` và phần phát event tương ứng, GIỮ `task.started = true` và `COROUTINE_STARTED`.

Kiểm `spawnInline` (`scheduler.ts:443+`) đã chuyển Active ngay lúc tạo chưa; nếu chưa thì làm cho giống, để mọi builder nhất quán.

- [ ] **Step 5: Chạy toàn bộ**

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

Test cũ nào khẳng định thứ tự event quanh `New→Active` sẽ đỏ — đó là test khẳng định hành vi lệch Kotlin. Cập nhật chúng và ghi rõ trong báo cáo là đã đổi cái gì, vì sao.

- [ ] **Step 6: Red-check**

1. Bỏ `job.transitionTo('Active')` lúc tạo (trả về hành vi cũ) → ca "Active ngay sau launch" phải đỏ.
2. Giữ CẢ chuyển đổi cũ trong `step()` lẫn chuyển đổi mới → ca "không vào Active hai lần" phải đỏ.
3. Chuyển Active lúc tạo nhưng KHÔNG phát `JOB_STATE` → ca "New->Active đứng ngay sau COROUTINE_CREATED" phải đỏ.

- [ ] **Step 7: Commit**

```bash
git add src/engine/runtime/scheduler.ts tests/engine/job-lifecycle.test.ts
git commit -m "fix(engine): coroutine Active ngay khi tạo, khớp CoroutineStart.DEFAULT"
```

---

### Task 20: Huỷ phải chạm được `delay()` nằm trong thân scope inline

Đo được (Task 4, đối chiếu `api.kotlinlang.org`):

```kotlin
fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            delay(1000)
            println("KHÔNG được in")
        }
    } catch (e: Exception) { println("caught: " + e.message) }
}
```
Kotlin thật in `caught: boom` — dòng `println` KHÔNG BAO GIỜ chạy, vì `delay()` bị huỷ ngay khi scope bị con fail kéo xuống. Engine in CẢ HAI dòng.

Nguyên nhân (đã truy vết ở Task 4 mục 5.2): chỉ `unwindCancelled()` mới ném exception vào generator, và nó chỉ xét `task.job.isCancelled` của các Task có generator THẬT. Job của builder inline có state đổi đúng, nhưng "task" của nó là một generator rỗng chưa từng chạy. Generator THẬT — cái đang treo tại `delay` — thuộc về task CHA, mà job của task cha thì không bị huỷ.

Đây là lỗ hổng ở đúng chỗ công cụ này tồn tại để dạy: "một con fail thì cả scope dừng lại ngay". Hiện engine cho scope chạy tiếp thêm 1000ms ảo rồi mới báo lỗi.

Task này **phụ thuộc Task 6**, vì nó dùng `Task.inlineStack` — sau Task 6, scheduler biết được task nào đang thực thi thân của job inline nào.

**Files:**
- Modify: `src/engine/runtime/scheduler.ts` (`unwindCancelled`)
- Test: `tests/engine/inline-cancel.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `Task.inlineStack` (Task 6).
- Produces: `unwindCancelled()` ném vào một task khi `task.job` HOẶC bất kỳ job nào trong `task.inlineStack` của nó đã bị huỷ.

- [ ] **Step 1: Đối chiếu Kotlin thật TRƯỚC khi sửa**

Chạy đoạn Kotlin ở trên qua API và dán output vào báo cáo. Chạy thêm biến thể `supervisorScope` (con fail bị chặn tại ranh giới nên scope KHÔNG bị huỷ — `delay` phải chạy hết và `println` PHẢI in) để có cặp đối chứng:

```kotlin
fun main() = runBlocking {
    supervisorScope {
        launch { throw RuntimeException("boom") }
        delay(1000)
        println("PHẢI in — supervisor chặn failure, scope không bị huỷ")
    }
}
```

- [ ] **Step 2: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('huỷ chạm tới delay() trong thân scope inline', () => {
  it('coroutineScope: con fail thì delay của chính thân scope bị cắt ngay', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            delay(1000)
            println("KHONG duoc in")
        }
    } catch (e: RuntimeException) {
        println("caught: " + e.message)
    }
}`)
    expect(r.output).toEqual(['caught: boom'])
  })

  it('cắt đúng THỜI ĐIỂM, không chỉ đúng nội dung', () => {
    // Nếu chỉ chặn println mà vẫn để đồng hồ ảo chạy hết 1000ms thì output
    // giống hệt ca trên nhưng bài học "dừng NGAY" đã sai.
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { delay(50); throw RuntimeException("boom") }
            delay(1000)
        }
    } catch (e: RuntimeException) { }
    println("xong")
}`)
    const cuối = r.events[r.events.length - 1]!
    expect(cuối.t).toBeLessThan(200)
  })

  it('supervisorScope: con fail bị chặn nên delay của thân KHÔNG bị cắt', () => {
    // Cặp đối chứng. Thiếu ca này thì một bản sửa "cứ có con fail là cắt thân"
    // vẫn làm ca đầu xanh trong khi phá vỡ ngữ nghĩa supervisor.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        launch { throw RuntimeException("boom") }
        delay(1000)
        println("PHAI in")
    }
}`)
    expect(r.output).toEqual(['PHAI in'])
  })

  it('scope lồng: chỉ scope bị huỷ mới bị cắt, scope ngoài chạy tiếp', () => {
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        try {
            coroutineScope {
                launch { throw RuntimeException("trong") }
                delay(1000)
                println("KHONG in")
            }
        } catch (e: RuntimeException) {
            println("bat o scope trong: " + e.message)
        }
        delay(100)
        println("scope ngoai van chay")
    }
}`)
    expect(r.output).toEqual(['bat o scope trong: trong', 'scope ngoai van chay'])
  })

  it('finally trong thân scope vẫn chạy khi bị cắt', () => {
    // Cùng lý do với Task 18 của M1: huỷ phải đi qua đường ném vào generator,
    // không phải đường lật cờ trạng thái.
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            try {
                delay(1000)
            } finally {
                println("don dep")
            }
        }
    } catch (e: RuntimeException) {
        println("caught")
    }
}`)
    expect(r.output).toEqual(['don dep', 'caught'])
  })
})
```

- [ ] **Step 3: Chạy để xác nhận đỏ**

Chạy: `npx vitest run tests/engine/inline-cancel.test.ts`. Dán output thật vào báo cáo, gồm cả ca "supervisorScope" — ca đó có thể ĐANG xanh, và nếu vậy phải ghi rõ nó xanh từ trước để về sau biết nó canh cái gì.

- [ ] **Step 4: Sửa `unwindCancelled`**

Điều kiện ném vào một task đổi từ "job của task bị huỷ" thành "job của task, HOẶC job inline trong cùng mà task đang thực thi, bị huỷ":

```ts
/**
 * Job nào đang thật sự chi phối việc task này còn được chạy tiếp hay không.
 *
 * Không phải lúc nào cũng là `task.job`: khi task đang treo giữa thân một
 * scope inline (`coroutineScope { delay(1000) }`), thân đó thuộc về job của
 * scope, và chính job đó mới là cái bị huỷ khi một con của scope fail. Trước
 * đây chỉ xét `task.job` nên tín hiệu huỷ không bao giờ tới nơi: job của scope
 * đổi state đúng, nhưng "task" của nó là generator rỗng chưa từng chạy, còn
 * generator thật thì thuộc task cha — mà cha không bị huỷ.
 */
private jobChiPhối(task: Task): Job {
  return task.inlineStack[task.inlineStack.length - 1] ?? task.job
}
```

Dùng nó trong `unwindCancelled` thay cho `task.job`, cả ở điều kiện lẫn ở chỗ lấy `failure`/cause để ném.

Cẩn thận hai chỗ:
- Sau khi ném vào, thân scope inline sẽ unwind qua đường `catch` của chính nó trong interpreter (`failInline` + `joinChildren`), rồi ném tiếp ra ngoài. Đừng ném lần thứ hai cho cùng một job.
- `supervisorScope` KHÔNG bị huỷ khi con trực tiếp fail (ranh giới chặn lại), nên `jobChiPhối` của nó vẫn Active và không có gì bị cắt. Đó là lý do ca đối chứng thứ ba phải xanh — nếu nó đỏ thì bản sửa đang phá ngữ nghĩa supervisor.

- [ ] **Step 5: Chạy toàn bộ**

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

Thay đổi này rút ngắn nhiều trace (đồng hồ ảo không còn chạy hết `delay` bị huỷ). Test cũ nào khẳng định thời điểm cũ là test khẳng định hành vi lệch Kotlin — cập nhật và ghi rõ.

- [ ] **Step 6: Red-check**

1. Trả `jobChiPhối` về `task.job` → ca đầu phải đỏ.
2. Cho `jobChiPhối` lấy job inline ĐÁY thay vì ĐỈNH ngăn xếp → ca "scope lồng" phải đỏ.
3. Bỏ điều kiện supervisor ở `reportFailure` (cho supervisor cũng bị huỷ theo con) → ca đối chứng thứ ba phải đỏ. Khôi phục ngay — đây là phá ở chỗ khác, chỉ để chứng minh ca đối chứng có canh gác.

- [ ] **Step 7: Commit**

```bash
git add src/engine/runtime/scheduler.ts tests/engine/inline-cancel.test.ts
git commit -m "fix(engine): huỷ chạm tới delay trong thân scope inline, khớp Kotlin thật"
```
