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
