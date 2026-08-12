import type { JobState } from '../../engine/trace/events'
import type { GraphNodeSpec } from '../../engine/trace/graph'
import type { WorldState } from '../../engine/trace/world'

/**
 * Giai đoạn sống của một node TẠI STEP ĐANG XEM — không phải trạng thái Kotlin
 * (`JobState`), mà là "toReactFlow nên vẽ nó kiểu gì":
 *   - 'unborn'   COROUTINE_CREATED của nó chưa xảy ra ở step này (world.jobs
 *                chưa có id này). Vẽ bóng mờ (Quyết định 2, lựa chọn b).
 *   - 'terminal' đã Completed/Cancelled — không còn đổi nữa trong phần trace
 *                còn lại (dù trace vẫn có thể phát thêm event LIÊN QUAN tới
 *                job này, ví dụ FAILURE_PROPAGATED muộn trỏ vào nó — tồn đọng
 *                A4 — nhưng bản thân state của job không đổi nữa).
 *   - 'live'     mọi trường hợp còn lại: New/Active/Completing/Cancelling.
 */
export type Phase = 'unborn' | 'live' | 'terminal'

const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['Completed', 'Cancelled'])

/** Đọc TỪNG node từ `world.jobs` — không suy từ cha (tồn đọng A1, xem toReactFlow.ts). */
export function phase(node: GraphNodeSpec, world: WorldState): Phase {
  const job = world.jobs.get(node.id)
  if (!job) return 'unborn'
  return TERMINAL_STATES.has(job.state) ? 'terminal' : 'live'
}

/**
 * accent theo builder — token CSS đã khai ở `theme/tokens.css`. Trả THẲNG
 * chuỗi `var(--k-*)`, không phải mã màu, để đổi theme chỉ cần sửa tokens.css,
 * không phải sửa TypeScript.
 */
const BUILDER_ACCENT: Readonly<Record<string, string>> = {
  runBlocking: 'var(--k-runBlocking)',
  launch: 'var(--k-launch)',
  async: 'var(--k-async)',
  coroutineScope: 'var(--k-coroutineScope)',
  supervisorScope: 'var(--k-supervisorScope)',
  withContext: 'var(--k-withContext)',
  // Job gốc của CoroutineScope(ctx). Cố ý TRUNG TÍNH (xám xanh), khác hẳn sáu
  // màu builder ở trên: nó không phải một builder mà người học gõ ra, chỉ là
  // cái neo cấu trúc mà `CoroutineScope(...)` dựng ngầm.
  scope: 'var(--k-scope)',
}

/** builder lạ (chưa có token, ví dụ M3 thêm builder mới) → về `--fg-dim`, không ném. */
export function builderAccent(builder: string): string {
  return BUILDER_ACCENT[builder] ?? 'var(--fg-dim)'
}

/**
 * viền theo JobState. Chỉ ba token màu trạng thái tồn tại trong tokens.css
 * (`--state-active`, `--state-completed`, `--state-cancelled`); `New` chưa
 * có gì để tô nên dùng `--fg-dim`. `Completing` xếp cùng `Active` (vẫn đang
 * chạy phần thân còn lại — Completing không phải trạng thái lỗi). `Cancelling`
 * xếp cùng `Cancelled` (đã trên đường huỷ, hình ảnh nên báo trước).
 */
const STATE_BORDER: Readonly<Record<JobState, string>> = {
  New: 'var(--fg-dim)',
  Active: 'var(--state-active)',
  Completing: 'var(--state-active)',
  Completed: 'var(--state-completed)',
  Cancelling: 'var(--state-cancelled)',
  Cancelled: 'var(--state-cancelled)',
}

export function stateBorder(state: JobState): string {
  return STATE_BORDER[state]
}
