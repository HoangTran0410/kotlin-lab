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
  // và cũng không báo gì, listOf(1).forEach { } không in gì, println(j.getCompleted())
  // in ra đúng chuỗi "kotlin.Unit". Hoãn phải nghĩa là ĐƯỢC BÁO.
  withTimeout: 'withTimeout chưa có ở M1. Dùng launch + delay + cancel() để dựng tay ca timeout.',
  withTimeoutOrNull: 'withTimeoutOrNull chưa có ở M1 (đi kèm withTimeout).',
  invokeOnCompletion: 'invokeOnCompletion chưa có ở M1. Xem trạng thái job trên trace thay vì gắn callback.',
  getCompleted: 'getCompleted() chưa có ở M1. Dùng await().',
  NonCancellable: 'NonCancellable chưa có ở M1.',
  coroutineContext: 'coroutineContext chưa có ở M1. Context hiện ra trên trace của từng coroutine.',
  listOf: 'Collection chưa có ở M1. Dùng for (i in 1..n) thay cho danh sách.',
  mutableListOf: 'Collection chưa có ở M1. Dùng for (i in 1..n) thay cho danh sách.',
  forEach: 'forEach chưa có ở M1. Dùng for (i in 1..n) hoặc repeat(n).',

  // CoroutineExceptionHandler ĐI QUA được cả parser lẫn context (applyCtxValue
  // đặt cờ handler, và CtxSummary.hasHandler thành true), nhưng KHÔNG ai gọi
  // nó: scheduler chưa bao giờ phát HANDLER_RECEIVED. Nên pattern Android kinh
  // điển nhất — scope gốc có handler để không sập app — chạy ở đây ra kết quả
  // của một scope KHÔNG có handler, mà không một lời cảnh báo. Đó đúng là loại
  // sai âm thầm mà công cụ này tồn tại để chống. Báo cho tới khi nó được cài.
  CoroutineExceptionHandler: 'CoroutineExceptionHandler chưa được cài — context nhận nó nhưng không '
    + 'ai gọi tới, nên kết quả sẽ giống hệt khi không có handler. Dùng try/catch quanh '
    + 'coroutineScope, hoặc supervisorScope, để thấy đường đi của failure.',

  // ---- Nằm ngoài phạm vi M3 hoặc dời tới milestone sau ----
  // children là Sequence<Job> — hỗ trợ nó kéo theo cả API sequence, ngoài
  // phạm vi M3. Cây job đã hiện sẵn trên đồ thị.
  children: 'Cây job đã hiện sẵn trên đồ thị — nhìn đồ thị thay vì duyệt job.children.',
  // Thread thật (không phải Thread ảo của engine) hoãn tới Task 7, khi có
  // cầu nối thread ảo. Trước đó, Thread.currentThread() từng trả Unit im
  // lặng và in ra "kotlin.Unit" — sai không tiếng động.
  Thread: 'Thread ảo hiện trên đồ thị và trên timeline. Xem badge thread của node.',
  currentThread: 'Thread ảo hiện trên đồ thị và trên timeline. Xem badge thread của node.',

  // CỐ Ý KHÔNG khai báo các điểm vào của Flow (flow/flowOf/asFlow/collect/
  // emit/launchIn/MutableStateFlow/...) ở đây, dù chúng cũng im lặng trả Unit.
  // Test 'nhận diện toán tử Flow chưa hỗ trợ gọi kiểu thành viên' dùng
  // `flowOf(1).buffer()` và khẳng định ĐÚNG MỘT chẩn đoán, cốt để chứng minh
  // chẩn đoán đó đến từ đường Member của `buffer` chứ không phải thứ khác lọt
  // vào. Khai báo flowOf sẽ làm thành hai và phá tiền đề của test đó. Flow
  // thuộc milestone sau; quyết định này để dành cho người lập kế hoạch Flow.
}
