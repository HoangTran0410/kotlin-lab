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

  // ---- Nằm trong subset §4.1 nhưng HOÃN tới sau M1 ----
  // Khác nhóm trên: những tên này sẽ có, chỉ là chưa. Chúng phải nằm ở đây vì
  // parser đọc được chúng, nên nếu không khai báo thì chúng rơi xuống nhánh
  // cuối của evalCall và trả Unit IM LẶNG: withTimeout(100) { } không chạy gì
  // và cũng không báo gì, listOf(1).forEach { } không in gì, println(j.isActive)
  // in ra đúng chuỗi "Job.isActive". Hoãn phải nghĩa là ĐƯỢC BÁO.
  withTimeout: 'withTimeout chưa có ở M1. Dùng launch + delay + cancel() để dựng tay ca timeout.',
  withTimeoutOrNull: 'withTimeoutOrNull chưa có ở M1 (đi kèm withTimeout).',
  ensureActive: 'ensureActive() chưa có ở M1. M1 chỉ huỷ ở điểm suspend (delay/yield).',
  invokeOnCompletion: 'invokeOnCompletion chưa có ở M1. Xem trạng thái job trên trace thay vì gắn callback.',
  getCompleted: 'getCompleted() chưa có ở M1. Dùng await().',
  isActive: 'job.isActive chưa có ở M1. Trạng thái Job đọc được trên trace.',
  isCancelled: 'job.isCancelled chưa có ở M1. Trạng thái Job đọc được trên trace.',
  isCompleted: 'job.isCompleted chưa có ở M1. Trạng thái Job đọc được trên trace.',
  NonCancellable: 'NonCancellable chưa có ở M1.',
  coroutineContext: 'coroutineContext chưa có ở M1. Context hiện ra trên trace của từng coroutine.',
  listOf: 'Collection chưa có ở M1. Dùng for (i in 1..n) thay cho danh sách.',
  mutableListOf: 'Collection chưa có ở M1. Dùng for (i in 1..n) thay cho danh sách.',
  forEach: 'forEach chưa có ở M1. Dùng for (i in 1..n) hoặc repeat(n).',

  // CỐ Ý KHÔNG khai báo các điểm vào của Flow (flow/flowOf/asFlow/collect/
  // emit/launchIn/MutableStateFlow/...) ở đây, dù chúng cũng im lặng trả Unit.
  // Test 'nhận diện toán tử Flow chưa hỗ trợ gọi kiểu thành viên' dùng
  // `flowOf(1).buffer()` và khẳng định ĐÚNG MỘT chẩn đoán, cốt để chứng minh
  // chẩn đoán đó đến từ đường Member của `buffer` chứ không phải thứ khác lọt
  // vào. Khai báo flowOf sẽ làm thành hai và phá tiền đề của test đó. Flow
  // thuộc milestone sau; quyết định này để dành cho người lập kế hoạch Flow.
}
