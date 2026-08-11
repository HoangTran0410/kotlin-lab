# Kotlin Coroutines Lab — Thiết kế

Ngày: 2026-08-11
Trạng thái: chờ review

## 1. Mục tiêu

Thay thế `kotlin_coroutines_visual_lab.html` (1 file, 379 dòng, 9 scenario hard-code) bằng
một ứng dụng có thể mở rộng, trong đó:

- User viết code Kotlin, tool tự sinh graph và chiếu luồng chạy.
- User tự tạo case mới mà không phải sửa mã nguồn tool.
- Code tách module, test được.

Mục tiêu cuối cùng là **học kotlinx.coroutines nhanh hơn**. Mọi quyết định thiết kế
dưới đây phục vụ mục tiêu đó, không phục vụ tính "đầy đủ tính năng".

### Phi mục tiêu (v1)

- Không phải một IDE Kotlin. Không autocomplete, không type inference đầy đủ, không refactor.
- Không chạy được Kotlin tuỳ ý. Chỉ chạy subset ở §4.1.
- Không mô phỏng nondeterminism. V1 chỉ sinh **một** thứ tự chạy (§2.4).
- Không có quiz/chấm điểm.

## 2. Quyết định kiến trúc

### 2.1 Simulator viết bằng TypeScript, không chạy JVM thật

Luồng chạy được sinh bởi một scheduler ảo viết bằng TypeScript, chạy hoàn toàn trong browser.

**Đã kiểm chứng vì sao không dùng JVM thật.** Đã dựng thử lại case supervisor bằng Kotlin
thật trên API của `play.kotlinlang.org`, tự viết instrumentation đi bộ cây Job và lấy mẫu
mỗi 25ms. Kết quả:

```
t=139  sup ACTIVE (SupervisorJobImpl)
t=180  sup.0 ACTIVE   sup.1 ACTIVE
       <- B ném RuntimeException tại đây; không mẫu nào bắt được
t=212  sup ACTIVE   sup.0 ACTIVE      <- sup.1 biến mất, không rõ nguyên nhân
t=263  A finished
@@END@@ supAlive=true
```

Bốn giới hạn chặn, đo được:

1. **Lấy mẫu từ ngoài không thấy được transition.** Chỉ thấy trạng thái tại thời điểm lấy
   mẫu. Child fail rồi biến mất giữa hai mẫu. Mà transition mới là nội dung bài học.
2. **Không có quan hệ nhân quả.** "sup.1 biến mất" khác "B failed, failure lên tới supervisor
   rồi bị chặn ở boundary".
3. **`kotlinx-coroutines-debug` không có trên classpath** của playground — thử `DebugProbes`
   trả `Unresolved reference 'DebugProbes'`. Không hook được transition, và không thể gắn
   bytecode agent vào một dịch vụ công cộng.
4. **Thời gian thật + nondeterministic.** `delay(1000)` tốn 1 giây thật, chạy lại ra khác,
   và không tua ngược được.

Simulator cho đúng thứ ngược lại: tức thì, deterministic, tua được hai chiều, và mỗi event
mang theo nguyên nhân.

### 2.2 Parser tự viết, không dùng tree-sitter

**Đã kiểm chứng.** `tree-sitter-kotlin@0.3.8` trên npm **không ship file `.wasm`** — chỉ có
`src/parser.c`, `src/scanner.c`, `grammar.js`. Muốn có wasm phải tự build bằng emscripten
hoặc tree-sitter CLI; máy không có `emcc`, không có `tree-sitter` CLI. Chỉ có Docker, nhưng
máy chạy CrowdStrike + Trellix + ManageEngine nên thêm toolchain native là thêm rủi ro treo.
`kotlin-parser-antlr` là bản 2021, không còn bảo trì, kéo theo ANTLR runtime.

Do đó: **lexer + recursive-descent parser viết tay bằng TypeScript**, chỉ phủ subset ở §4.1.

Lợi ích đi kèm: interpreter và parser dùng chung một định nghĩa "được hỗ trợ", nên báo lỗi
chính xác theo dòng bằng tiếng Việt ("dòng 12: `select {}` chưa được hỗ trợ") thay vì đổ vỡ
mơ hồ khi đi trên CST đầy đủ.

### 2.3 Interpreter dùng JS generator, không dùng CPS thủ công

Interpreter phải suspend giữa chừng một biểu thức rồi resume. Hai cách: tự quản stack frame
theo kiểu CPS (giống compiler Kotlin làm thật, nhưng lượng code rất lớn), hoặc dùng generator
của JS.

Chọn generator:

```ts
function* evalNode(node: AstNode, env: Env): Generator<Suspension, Value>
```

Mỗi điểm suspend (`delay`, `await`, `join`, `yield`, `collect`, `emit`) `yield` ra một
`Suspension`; scheduler quyết định khi nào `.next(value)` để resume.

Lý do quyết định: **`try/catch/finally` của JS hoạt động xuyên qua `yield`**. Nghĩa là mô
hình hoá `finally` chạy khi coroutine bị cancel — thứ khó hiểu và dễ sai bậc nhất với người
học — gần như miễn phí, thay vì phải tự cài cơ chế unwinding.

### 2.4 Deterministic tuyệt đối ở v1

Cùng một đoạn code luôn sinh ra đúng một trace. Scheduler dùng thứ tự hàng đợi cố định.

Đây là đánh đổi có ý thức: Kotlin thật có thể interleave khác. **UI phải ghi rõ điều này**,
không được để người học tưởng đây là thứ tự duy nhất khả dĩ. Việc khám phá các interleaving
khác ("nếu thread kia thắng race thì sao") để v2 (§11).

### 2.5 Một app Vite, không monorepo

Ranh giới thật sự cần bảo vệ là **engine không được phụ thuộc UI**, để engine test được
headless và không lẫn state của React. Ranh giới đó ép bằng ESLint `no-restricted-imports`
(cấm import `react`, `@xyflow/*`, DOM API trong `src/engine/**`), không cần dựng npm
workspace. Ít ma sát hơn, cùng mức module hoá.

## 3. Kiến trúc tổng thể

```
Kotlin source (string)
  |  lexer
  v
Token[]
  |  parser
  v
AST
  |  validator  -> Diagnostic[] (dừng ở đây nếu có lỗi)
  v
Interpreter chạy trên VirtualScheduler
  |  emit
  v
Event[]  <- NGUỒN SỰ THẬT DUY NHẤT
  |  fold(0..N)
  v
WorldState tại step N  ->  layout (elkjs)  ->  React Flow
                       ->  narrate()       ->  panel diễn giải
                       ->  console         ->  output println
```

**Nguyên tắc trung tâm: trace là nguồn sự thật duy nhất.** Mọi thứ UI hiển thị tại step N
đều suy ra bằng cách fold event từ 0 đến N. Hệ quả trực tiếp: tua ngược, nhảy tới bất kỳ
step nào, và so sánh hai trace đều là hàm thuần, không cần cơ chế riêng.

Đây chính là điều bản HTML hiện tại không làm được: nó chỉ tiến, reset là mất hết.

## 4. Engine

### 4.1 Subset Kotlin được hỗ trợ

Đây là hợp đồng giữa parser, validator và interpreter. Ngoài danh sách này -> báo lỗi rõ ràng.

**Cấu trúc ngôn ngữ**

- `fun main()`, `fun main() = runBlocking { }`, hàm top-level, `suspend fun`
- `val` / `var`, tham số mặc định, tham số có tên
- Lambda, trailing lambda, `it`, lambda có tham số đặt tên
- `if`/`else` (cả dạng biểu thức), `while`, `for (x in a..b)`, `repeat(n)`
- `try`/`catch`/`finally`, `throw`
- `when` (dạng cơ bản: nhánh giá trị và `else`)
- String template (`"$x"`, `"${expr}"`), toán tử số học và so sánh
- Truy cập thuộc tính và gọi phương thức trên các kiểu built-in bên dưới
- `println`

**Coroutine builders & scope**

- `CoroutineScope(ctx)`, `MainScope()`, `GlobalScope`
- `launch`, `async`, `runBlocking`
- `coroutineScope { }`, `supervisorScope { }`
- `withContext(ctx)`, `withTimeout(ms)`, `withTimeoutOrNull(ms)`

**Job & lifecycle**

- `Job()`, `SupervisorJob()`, `Job(parent)`
- `job.cancel()`, `job.cancelAndJoin()`, `job.join()`
- `job.isActive`, `job.isCancelled`, `job.isCompleted`, `job.children`
- `job.invokeOnCompletion { }`
- `Deferred<T>`, `await()`, `deferred.getCompleted()`
- `delay(ms)`, `yield()`, `ensureActive()`, `isActive` (trong scope)
- `NonCancellable`
- `CancellationException`

**Context**

- Toán tử `+` để ghép element
- `Dispatchers.Main` / `.IO` / `.Default` / `.Unconfined`
- `CoroutineName("x")`
- `CoroutineExceptionHandler { ctx, e -> }`
- `coroutineContext[Job]`, `coroutineContext[CoroutineName]`

**Flow**

- `flow { emit(x) }`, `flowOf(...)`, `asFlow()`
- `collect { }`, `collectLatest { }`
- `map`, `filter`, `onEach`, `catch`, `onCompletion`, `take`
- `flowOn(dispatcher)`, `launchIn(scope)`
- `MutableStateFlow(x)`, `.value`, `StateFlow`
- `MutableSharedFlow()`, `.emit()`, `SharedFlow`

**Không hỗ trợ ở v1 (báo lỗi rõ ràng, có gợi ý)**

`Channel`, `produce`, `actor`, `select`, `Mutex`, `Semaphore`, `buffer`, `conflate`,
`debounce`, `combine`, `zip`, `class`/`interface`/`object` do user định nghĩa, generics do
user định nghĩa, `suspendCoroutine`, interop Java.

### 4.2 Module engine

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `lexer/` | Token hoá: định danh, từ khoá, số, chuỗi + template, toán tử, chú thích, newline có nghĩa | không |
| `ast/` | Định nghĩa kiểu node | không |
| `parser/` | Đệ quy Token[] -> AST | lexer, ast |
| `validator/` | Duyệt AST, phát hiện construct ngoài §4.1 -> Diagnostic[] | ast |
| `runtime/job` | State machine Job | không |
| `runtime/context` | CoroutineContext = map element | runtime/job |
| `runtime/clock` | Thời gian ảo, hàng đợi timer | không |
| `runtime/dispatcher` | Hàng đợi ready + pool thread ảo | runtime/clock |
| `runtime/propagation` | Luật cancel xuống / failure lên / chặn ở supervisor | runtime/job |
| `runtime/flow` | Cold flow, StateFlow, SharedFlow | runtime/job |
| `runtime/scheduler` | Vòng lặp điều phối, phát Event | tất cả runtime/* |
| `interpreter/` | Tree-walking bằng generator | ast, runtime/* |
| `trace/` | Kiểu Event, fold -> WorldState, chỉ mục theo step | không |
| `narrate/` | Event + WorldState -> câu tiếng Việt | trace |

Không module nào trong `engine/` được import React hay chạm DOM.

### 4.3 Mô hình runtime

**Job state machine** — theo đúng tài liệu kotlinx.coroutines:

```
New -> Active -> Completing -> Completed
         |            |
         v            v
     Cancelling -> Cancelled
```

Mỗi Job giữ: `id`, `parent`, `children[]`, `isSupervisor`, `state`, `cause`.

**Luật lan truyền** (`runtime/propagation`, là nơi tập trung toàn bộ ngữ nghĩa khó):

- Cancel đi **xuống**: cancel một Job -> cancel toàn bộ descendant.
- Failure đi **lên**: child kết thúc bất thường (không phải `CancellationException`) ->
  báo lên parent.
- **Supervisor boundary**: nếu parent là supervisor, failure của **direct child** dừng lại
  ở đó; parent không fail, sibling không bị cancel. Exception chưa được xử lý vẫn đi tiếp
  tới `CoroutineExceptionHandler` hoặc handler mặc định.
- `CancellationException` là bình thường, không làm parent fail.
- `async` giữ failure trong `Deferred`; `await()` mới ném ra. Điều này **không** huỷ bỏ việc
  failure vẫn lan lên parent theo quan hệ cấu trúc.

**Clock ảo**: `delay(1000)` đặt một timer tại `t+1000` rồi suspend, không ngủ thật. Khi mọi
coroutine đều suspend, scheduler nhảy đồng hồ tới timer gần nhất. Toàn bộ chương trình chạy
xong trong vài mili giây thật.

**Dispatcher ảo**: mỗi dispatcher có một pool thread ảo (`Main` 1, `Default` 4, `IO` 8) và
một hàng đợi ready. Thread ảo là đối tượng hiển thị được, để thấy coroutine đổi thread sau
khi resume — và thấy thread được trả về pool khi suspend chứ không bị block.

### 4.4 Schema Event

Mọi event có `seq` (tăng đơn điệu) và `t` (mili giây ảo).

```ts
type Event = { seq: number; t: number; srcLine?: number } & (
  | { k: 'COROUTINE_CREATED';   id: JobId; parentId: JobId | null;
                                 builder: 'launch'|'async'|'runBlocking'|'coroutineScope'
                                        |'supervisorScope'|'withContext'; ctx: CtxSummary }
  | { k: 'COROUTINE_STARTED';   id: JobId; threadId: ThreadId }
  | { k: 'COROUTINE_SUSPENDED'; id: JobId;
                                 reason: 'delay'|'await'|'join'|'yield'|'collect'|'emit' }
  | { k: 'COROUTINE_RESUMED';   id: JobId; threadId: ThreadId }
  | { k: 'JOB_STATE';           id: JobId; from: JobState; to: JobState; cause?: string }
  | { k: 'EXCEPTION_THROWN';    id: JobId; exType: string; message: string }
  | { k: 'EXCEPTION_CAUGHT';    id: JobId; exType: string }
  | { k: 'FAILURE_PROPAGATED';  from: JobId; to: JobId; blockedBySupervisor: boolean }
  | { k: 'CANCEL_REQUESTED';    from: JobId | 'user'; to: JobId; cause: string }
  | { k: 'HANDLER_RECEIVED';    id: JobId; handler: 'CEH'|'platform'; exType: string }
  | { k: 'DISPATCH';            id: JobId; dispatcher: string; threadId: ThreadId }
  | { k: 'THREAD_STATE';        threadId: ThreadId; state: 'RUNNING'|'FREE' }
  | { k: 'PRINTLN';             id: JobId; text: string }
  | { k: 'FLOW_CREATED';        id: FlowId; kind: 'cold'|'state'|'shared' }
  | { k: 'FLOW_COLLECT_START';  flowId: FlowId; collectorJob: JobId }
  | { k: 'FLOW_EMIT';           flowId: FlowId; value: string; stage?: string }
  | { k: 'FLOW_COMPLETED';      flowId: FlowId; cause?: string }
)
```

`srcLine` cho phép highlight đúng dòng code đang chạy tại mỗi step.

`FAILURE_PROPAGATED` mang `blockedBySupervisor` — đây chính là dữ liệu để vẽ hiệu ứng
"chặn ở boundary" mà bản hiện tại đang phải hard-code bằng op `block`.

### 4.5 Sinh diễn giải

`narrate(event, worldState): string` là hàm thuần, sinh câu tiếng Việt từ dữ liệu có cấu trúc.
Ví dụ `FAILURE_PROPAGATED{from: B, to: P, blockedBySupervisor: false}` cho ra:

> "B kết thúc bất thường. Vì P là Job thường (không phải supervisor), failure lan lên P."

Vì là hàm thuần nên test được, và case do user tự viết cũng có diễn giải mà không phải viết tay.

Lesson có sẵn được bổ sung thêm phần "mental model" viết tay ở mức **cả bài**, không phải
mức từng step — đó là phần tri thức mà simulator không tự sinh ra được.

## 5. Đối chiếu với JVM thật

Module `src/verify/`, dùng API công khai của Kotlin Playground:

```
POST https://api.kotlinlang.org/api/2.1.21/compiler/run
body: {"args":"","files":[{"name":"File.kt","publicId":"","text":"..."}],"confType":"java"}
-> {"errors":{...},"exception":null,"text":"<outStream>...</outStream>"}
```

Đã kiểm chứng chạy được (§2.1).

Hai công dụng:

1. **Nút "Chạy trên JVM thật"** — bấm tay. Hiện output thật cạnh output do simulator dự đoán.
   Khớp thì tin được simulator; lệch thì chính chỗ lệch là bài học về nondeterminism.
2. **Golden fixture** — mỗi lesson chạy thật **một lần**, lưu output vào repo dưới
   `src/lessons/<id>/expected-jvm-output.txt`. Test của engine assert output dự đoán khớp
   fixture. Tính đúng của simulator được neo vào compiler Kotlin thật, mà test vẫn chạy offline.

**Ràng buộc bắt buộc**: đây là dịch vụ công cộng miễn phí của JetBrains.

- Chỉ gọi khi user bấm nút. Tuyệt đối không gọi tự động theo mỗi lần gõ phím.
- Fixture lưu trong repo, không fetch lại khi chạy test.
- Lỗi mạng phải xử lý êm; toàn bộ phần học phải chạy được offline.

Nếu về sau cần dùng nặng: `kotlin-compiler-server` là mã nguồn mở, tự host bằng Docker được.

## 6. UI

React + TypeScript + Vite. Giữ nguyên ngôn ngữ thị giác của bản hiện tại (nền tối, accent
theo `kind` của node) — phần đó đang tốt, không đập đi.

| Thành phần | Nội dung |
|---|---|
| `CodeEditor` | CodeMirror 6, cú pháp Kotlin, tự highlight dòng đang chạy theo `srcLine` |
| `GraphCanvas` | React Flow (`@xyflow/react` 12) + elkjs. Node tuỳ biến theo kind |
| `Timeline` | Thanh kéo hai chiều, play/pause/step/tốc độ, đánh dấu event |
| `Narration` | Diễn giải step hiện tại + lịch sử |
| `Console` | Output `println` theo đúng thứ tự thời gian ảo |
| `DiagnosticsPanel` | Lỗi parse/validate, kèm số dòng |
| `CompareView` | Hai pane, chung một timeline, tô chỗ hai trace rẽ nhánh |
| `LessonNav` | Lộ trình bài học có thứ tự, đánh dấu đã học |
| `VerifyPanel` | Output dự đoán cạnh output JVM thật |

**Layout bằng elkjs, không đặt toạ độ tay.** Bắt buộc, vì code do user viết thì không thể
biết trước có bao nhiêu node. ELK hỗ trợ **compound node**, nên scope sẽ *bao* children thật
sự thay vì các hộp rời như hiện tại — đúng hơn về mặt cấu trúc và dễ đọc hơn.

**UI phải hiển thị thường trực một dòng ghi rõ** đây là mô phỏng deterministic, Kotlin thật
có thể interleave khác (theo §2.4).

State: Zustand. Trace nằm ngoài React state (chỉ giữ `stepIndex` trong store, `WorldState`
tính bằng selector có memo hoá).

## 7. Lesson

9 scenario hiện tại được **viết lại thành file `.kt` thật**, chạy qua simulator, giữ lại phần
"mental model" viết tay:

`suspend` · `jobtree` · `exception` · `normalfail` · `supervisor` · `launchasync` ·
`dispatcher` · `scopecompare` · `nestedtrap`

Thêm cho phần Flow: cold vs hot, `flowOn` và context preservation, `StateFlow` với nhiều
subscriber.

Mỗi lesson:

```
src/lessons/<id>/
  main.kt                    # code Kotlin thật
  meta.json                  # tiêu đề, mô tả, thứ tự, khái niệm liên quan
  mental-model.md            # phần giải thích viết tay
  expected-trace.json        # golden trace của simulator
  expected-jvm-output.txt    # output thật từ playground, chạy 1 lần
```

Việc chuyển 9 scenario này vừa xoá hard-code, vừa tạo ra **bộ test chứng minh simulator tuân
đúng luật** — vì kết quả mong đợi của chúng đã biết trước và đã được kiểm chứng.

## 8. Lưu trữ

- Case user tạo: `localStorage`, có versioning schema.
- Export/import JSON để backup và chia sẻ.
- Chia sẻ bằng URL: nén code vào hash fragment.

Không ghi ra file `.kt` trong thư mục dự án — app chạy trong browser, không có quyền ghi
file, và làm vậy sẽ trộn lẫn nội dung user với mã nguồn tool.

## 9. Chiến lược test

Vitest, chạy trên engine (không cần DOM).

| Loại | Nội dung |
|---|---|
| Lexer/Parser | Unit test theo từng construct ở §4.1 |
| Validator | Construct chưa hỗ trợ phải báo đúng dòng và có gợi ý |
| Propagation | Test riêng từng luật: cancel xuống, failure lên, chặn ở supervisor, CancellationException không làm fail |
| Golden trace | 9 lesson cũ + lesson Flow: trace sinh ra khớp `expected-trace.json` |
| Đối chiếu JVM | Output dự đoán khớp `expected-jvm-output.txt` |
| Fold trace | `fold(0..N)` rồi tua ngược về M phải bằng `fold(0..M)` |

Test propagation là quan trọng nhất — đó là nơi ngữ nghĩa dễ sai nhất, và cũng là nội dung
chính người học cần đúng.

## 10. Cấu trúc thư mục

```
~/Desktop/kotlin-coroutines-lab/
  src/
    engine/          # TypeScript thuần, cấm import React (ép bằng ESLint)
      lexer/ ast/ parser/ validator/
      runtime/       # job, context, clock, dispatcher, propagation, flow, scheduler
      interpreter/
      trace/ narrate/
    ui/              # React component
    lessons/         # .kt + meta + golden fixture
    state/           # Zustand
    verify/          # client gọi Kotlin Playground
  tests/
  docs/superpowers/specs/
```

## 11. Thứ tự triển khai

Dự án này đủ lớn để cần mốc rõ ràng. Mỗi mốc phải **chạy được và kiểm chứng được**, không
phải nửa vời chờ mốc sau.

**M1 — Engine xương sống, chưa có UI.**
Lexer, parser, validator cho phần core §4.1 (chưa Flow). Job state machine, clock ảo,
dispatcher, propagation. Interpreter generator. Sinh `Event[]`.
*Kiểm chứng*: chạy được lesson `jobtree`, `normalfail`, `supervisor` bằng test, so với golden
trace viết tay. Không cần mở browser.

**M2 — UI tối thiểu chạy thông suốt.**
Vite + React, CodeEditor, GraphCanvas + elkjs, Timeline kéo hai chiều, Console.
*Kiểm chứng*: gõ code vào, thấy graph và tua được hai chiều.

**M3 — Đủ 9 lesson cũ + diễn giải.**
Chuyển hết 9 scenario thành `.kt`, `narrate()`, LessonNav, DiagnosticsPanel.
*Kiểm chứng*: 9 golden trace test xanh; nội dung dạy học không thua bản HTML cũ.

**M4 — Flow.**
`runtime/flow`, parser + interpreter cho phần Flow §4.1, lesson Flow, node Flow trên graph.

**M5 — Đối chiếu JVM thật + CompareView + lưu trữ.**
`src/verify/`, golden fixture, VerifyPanel, CompareView, localStorage + export/import + URL.

Sau M3 là đã thay thế được hoàn toàn bản HTML hiện tại. M4 và M5 là phần mở rộng thêm.

## 12. Rủi ro đã biết

| Rủi ro | Xử lý |
|---|---|
| Parser tự viết vỡ trên cú pháp Kotlin ngoài dự kiến | Validator báo lỗi rõ theo dòng thay vì đổ vỡ; subset khai báo tường minh ở §4.1 |
| Ngữ nghĩa simulator lệch Kotlin thật | Golden fixture từ JVM thật (§5) neo tính đúng |
| User tưởng thứ tự deterministic là thứ tự duy nhất | UI ghi rõ thường trực (§6) |
| API JetBrains đổi hoặc chặn | Chỉ dùng cho tính năng phụ; toàn bộ phần học chạy offline |
| Interpreter generator phình to khó bảo trì | Ngữ nghĩa khó tập trung ở `runtime/propagation`, không rải trong interpreter |

## 13. Để dành cho v2

- Khám phá interleaving khác nhau (thay đổi thứ tự scheduler, xem race condition).
- `Channel`, `select`, `Mutex`, backpressure.
- Toán tử Flow nâng cao: `buffer`, `conflate`, `debounce`, `combine`, `zip`.
- Quiz đoán trước kết quả.
