import { TraceEmitter } from '../trace/emitter'
import type { JobId } from '../trace/events'
import { VirtualClock } from './clock'
import { CoroutineContext } from './context'
import { DispatcherPool } from './dispatcher'
import { Job, type FailureCause } from './job'
import { cancelJob, reportFailure } from './propagation'
import type { CoroutineBody, Suspension, VoidCoroutineBody } from './suspension'
import { KotlinThrow } from '../interpreter/values'

interface Task {
  job: Job
  ctx: CoroutineContext
  body: CoroutineBody
  /** Giá trị trả vào .next() ở lần resume tới. */
  resumeValue: unknown
  /**
   * Khi khác undefined: lần resume tới phải NÉM vào generator thay vì next().
   * Đường thứ hai này tồn tại cho `await` trên một Deferred đã fail — exception
   * phải xuất hiện tại chính điểm await, kể cả khi supervisor đã chặn không cho
   * failure ấy ảnh hưởng tới scope.
   */
  resumeThrow: unknown
  started: boolean
  /**
   * Dòng để gắn cho `COROUTINE_STARTED` — dòng ĐẦU TIÊN trong thân coroutine,
   * tức chỗ nó thật sự bắt đầu chạy, chứ không phải dòng viết `launch`.
   */
  startLine: number | undefined
  /**
   * Dòng của điểm suspend đang treo. `COROUTINE_RESUMED` gắn dòng này, vì
   * resume nghĩa là chạy tiếp TỪ ĐÓ. Không có nó thì mọi RESUMED không mang
   * dòng nào, và con trỏ trong editor đứng im suốt những đoạn dài — đo được
   * 16 step liên tiếp không đổi dòng trên lesson scopecompare.
   */
  resumeLine: number | undefined
  /** Đã chạy xong hoặc đã unwind — không được đụng tới generator nữa. */
  finished: boolean
  /**
   * Đã ném tín hiệu huỷ vào generator này rồi, mà nó CHƯA chạy hết.
   *
   * Tồn tại vì unwind không còn luôn đồng bộ: generator có thể BẮT được tín
   * hiệu huỷ rồi treo lại ở một điểm suspend khác — `runInlineBody` bắt xong
   * là `yield joinChildren` để chờ con của scope chạy hết `finally` — nên
   * `body.throw()` TRẢ VỀ một IteratorResult thay vì ném ra, và task còn phải
   * được chạy tiếp.
   *
   * Dùng ĐÚNG MỘT việc: mở chốt `job.isCompleted` ở đầu `step()`. Job đã
   * Cancelled từ trước khi tín hiệu được ném vào, nên nếu không có cờ này thì
   * lượt resume kế tiếp bị chốt ấy chặn, generator bị bỏ rơi giữa chừng,
   * `finished` không bao giờ được đặt và người `join()` nó treo vĩnh viễn.
   *
   * CỐ Ý KHÔNG dùng nó để chống ném hai lần: Kotlin ném CancellationException ở
   * MỌI điểm suspend của một coroutine đã huỷ, không phải chỉ điểm đầu tiên.
   * Việc chống ném hai lần chỉ áp cho `joinChildren` của scope inline — xem
   * `đangChờConCủaScope`.
   */
  unwinding: boolean
  /**
   * Các scope inline (runBlocking/coroutineScope/supervisorScope/withContext)
   * chạy trong generator của task NGOÀI, nên `currentJob` — vốn được gán từ
   * task.job ở đầu mỗi step() — không phải job đang thật sự thực thi. Ngăn xếp
   * này giữ job inline trong cùng CỦA RIÊNG TASK NÀY, và mọi event phát ra nhân
   * danh "job hiện tại" phải đọc qua đây.
   *
   * Trên Task chứ không trên Scheduler: task có thể treo giữa thân một scope
   * inline (`coroutineScope { delay(100) }`) trong khi task khác chạy. Ngăn xếp
   * dùng chung ở mức Scheduler sẽ gán job inline của task đang treo cho
   * `println` của task đang chạy — sai âm thầm, và chỉ hiện ra khi có hai
   * coroutine xen kẽ.
   */
  inlineStack: Job[]
  /**
   * Dispatcher của cha TẠI LÚC TẠO, hoặc null nếu không có cha.
   *
   * Chụp lại thay vì đọc `ctx` của task cha khi cần: từ khi có `switchContext`,
   * `task.ctx` là dữ liệu THAY ĐỔI ĐƯỢC — cha có thể đang ở giữa một
   * `withContext(IO)` khi con lần đầu được chạy, và lúc đó so với ctx hiện thời
   * của cha sẽ nuốt mất một DISPATCH có thật. Kotlin dispatch continuation đầu
   * tiên của con ngay tại chỗ `launch` (CoroutineStart.DEFAULT), nên mốc so
   * sánh đúng là dispatcher lúc TẠO.
   */
  parentDispatcher: string | null
}

export function toCause(err: unknown): FailureCause {
  // Nhận dạng theo hình dạng chứ không phải `instanceof KotlinThrow`: test của
  // Scheduler dựng exception giả bằng Object.assign(new Error, { kotlinType }),
  // và Scheduler không có lý do gì phải phụ thuộc vào lớp cụ thể của interpreter.
  if (err && typeof err === 'object' && 'kotlinType' in err) {
    const e = err as { kotlinType: string; kotlinMessage?: string; message?: string; line?: number }
    return {
      exType: e.kotlinType,
      // Ưu tiên kotlinMessage. Error.message của KotlinThrow được dựng thành
      // `${kotlinType}: ${kotlinMessage}`, nên đọc nhầm sẽ nhân đôi tên kiểu:
      // `catch (e: RuntimeException) { println(e.message) }` in ra
      // "RuntimeException: boom" thay vì "boom".
      message: e.kotlinMessage ?? e.message ?? '',
      isCancellation: e.kotlinType === 'CancellationException',
      // Duck-typed (không instanceof) như phần còn lại của hàm này — test của
      // Scheduler dựng lỗi giả bằng Object.assign và không mang `line`, nên
      // đọc optional-chaining ra undefined là đúng, không phải lỗi.
      line: e.line,
    }
  }
  return { exType: 'Exception', message: String(err), isCancellation: false }
}

/**
 * Lỗi của ENGINE, không phải exception của chương trình Kotlin đang chạy: một
 * bất biến đã vỡ và không có nghĩa nào để "chạy tiếp".
 *
 * Nhận dạng theo hình dạng chứ không `instanceof KotlinThrow`, đúng cùng lý do
 * (và cùng cách) như `toCause`: test của Scheduler dựng exception Kotlin giả
 * bằng `Object.assign(new Error, { kotlinType })`, và những cái đó phải được coi
 * là exception của chương trình.
 *
 * `ReturnSignal` của interpreter KHÔNG phải Error nên không lọt vào đây — nó là
 * tín hiệu điều khiển nội bộ, giữ nguyên đường xử lý cũ.
 */
function isEngineError(err: unknown): boolean {
  return err instanceof Error && !('kotlinType' in err)
}

export class Scheduler {
  readonly emitter = new TraceEmitter()
  readonly clock = new VirtualClock()
  readonly pool = new DispatcherPool()

  private nextJobId = 1
  private readonly ready: Task[] = []
  private readonly tasks = new Map<JobId, Task>()
  /** Mảng song song với `tasks`, để duyệt theo đúng thứ tự tạo. */
  private readonly taskOrder: Task[] = []
  private currentJob: Job | null = null
  /**
   * Task đang chạy generator NGAY LÚC NÀY. Đi kèm `currentJob` và luôn được đặt/
   * xoá cùng lúc với nó; tách ra vì ngăn xếp scope inline nằm trên Task.
   */
  private currentTask: Task | null = null
  /** Coroutine gốc. Chương trình kết thúc khi nó kết thúc — xem runToCompletion. */
  private rootJobId: JobId | null = null
  /**
   * Task vừa đi qua `switchContext` và đang chờ được chạy lại trên dispatcher
   * mới, kèm job đứng tên DISPATCH và dòng gây ra. Không thể phát DISPATCH ngay
   * trong `suspend()`: threadId chỉ biết được sau khi `acquire` ở step kế.
   */
  private readonly pendingDispatch = new Map<Task, { jobId: JobId; line?: number }>()

  /**
   * Task đang chờ một job khác kết thúc. Mảng, không phải Map lồng, để thứ tự
   * đánh thức ổn định — đây là điều kiện cho trace deterministic.
   *
   * KHÔNG được cài chờ bằng cách tự lên lịch lại ở cùng mốc thời gian: làm vậy
   * thì `ready` không bao giờ rỗng, đồng hồ ảo không bao giờ nhảy, và mọi thứ
   * đứng hình. Waiter phải nằm NGOÀI `ready` cho tới khi điều kiện thoả.
   */
  private waiters: { task: Task; kind: 'join' | 'await' | 'children'; targetId: JobId }[] = []

  private newJobId(): JobId { return `j${this.nextJobId++}` }

  /**
   * Job mà code đang chạy THUỘC VỀ, khác với `currentJob` (job của task).
   * Trong `withContext(Dispatchers.IO) { println("x") }`, task đang chạy vẫn là
   * task của runBlocking, nhưng dòng println đó thuộc về job withContext — đó
   * là thứ đồ thị phải highlight. Mọi event phát ra nhân danh "job hiện tại"
   * phải đọc qua đây, đừng đọc `currentJob`.
   */
  private get currentInlineJob(): Job | null {
    const t = this.currentTask
    return t ? (t.inlineStack[t.inlineStack.length - 1] ?? t.job) : this.currentJob
  }

  /** Dispatcher THẬT của task đang chạy — đã tính cả các withContext lồng nhau. */
  currentDispatcher(): string {
    if (!this.currentTask) {
      // Không có task nào đang chạy thì không có dispatcher nào "đang hiệu lực".
      // Trả bừa 'Default' ở đây sẽ làm interpreter tưởng đang đổi dispatcher và
      // phát DISPATCH rác; chết ngay còn hơn dựng trace sai.
      throw new Error('Scheduler: currentDispatcher() được gọi ngoài lúc chạy một task')
    }
    return this.currentTask.ctx.dispatcher
  }

  /** Dispatcher hiệu lực của một job đã tồn tại (ctx của nó đã merge với cha). */
  dispatcherOf(jobId: JobId): string {
    const task = this.tasks.get(jobId)
    if (!task) throw new Error(`Scheduler: không có task nào cho job ${jobId}`)
    return task.ctx.dispatcher
  }

  println(text: string, srcLine?: number): void {
    this.emitter.emit({ k: 'PRINTLN', id: this.currentInlineJob?.id ?? 'j0', text }, srcLine)
  }

  spawnRoot(makeBody: (job: Job) => CoroutineBody): Job {
    const job = this.spawn(
      null, false, 'runBlocking', CoroutineContext.empty().withDispatcher('Main'), makeBody)
    this.rootJobId = job.id
    return job
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
    srcLine?: number,
    startLine?: number,
  ): Job {
    const id = this.newJobId()
    const job = new Job(id, ctx.name ?? id, parent, isSupervisor)
    parent?.addChild(job)

    const jobCtx = ctx.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
    }, srcLine)
    // CoroutineStart.DEFAULT (đường DUY NHẤT subset này hỗ trợ, xem spec §4.1):
    // Kotlin thật coi coroutine vừa tạo là Active NGAY LẬP TỨC — `New` chỉ tồn
    // tại với CoroutineStart.LAZY, ngoài subset. `launch`/`async` trả về đồng
    // bộ, nên mọi câu lệnh đứng giữa lời gọi và điểm suspend kế tiếp phải thấy
    // Active, không phải New. Đối chiếu Kotlin thật (api.kotlinlang.org 2.1.20):
    // `val job = launch { delay(10) }; println(job.isActive)` in "true".
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })

    const task: Task = {
      job, ctx: jobCtx, body: makeBody(job), resumeValue: undefined, resumeThrow: undefined,
      started: false, finished: false, unwinding: false, inlineStack: [],
      startLine: startLine ?? srcLine, resumeLine: undefined,
      parentDispatcher: parent ? this.tasks.get(parent.id)?.ctx.dispatcher ?? null : null,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    this.ready.push(task)
    return job
  }

  jobById(id: JobId | null): Job | null {
    return id ? this.tasks.get(id)?.job ?? null : null
  }

  /**
   * "Xong" theo nghĩa mà người CHỜ quan tâm: state đã kết thúc VÀ thân coroutine
   * đã unwind xong.
   *
   * Chỉ hỏi `job.isCompleted` là chưa đủ. cancelJob lật thẳng
   * Active->Cancelling->Cancelled trong MỘT lời gọi đồng bộ, nên không job nào
   * bao giờ NGHỈ ở Cancelling: ngay sau `j.cancel()` thì j đã isCompleted trong
   * khi generator của nó còn treo ở điểm suspend và khối `finally` chưa hề chạy.
   * Đánh thức người chờ lúc đó là để `j.join()` trả về TRƯỚC khi j kịp dọn dẹp —
   * Kotlin cho ["cleanup", "done"], engine cũ cho ["done", "cleanup"].
   *
   * `!task.started` là ca huỷ-trước-khi-chạy: không có gì để unwind, nên xong
   * ngay. Không có nhánh này thì unwindCancelled (vốn bỏ qua task chưa start)
   * sẽ không bao giờ đặt `finished`, và người chờ treo vĩnh viễn.
   */
  private isJobSettled(id: JobId): boolean {
    const task = this.tasks.get(id)
    if (!task) return true
    if (!task.job.isCompleted) return false
    return task.finished || !task.started
  }

  /**
   * Đánh thức waiter có điều kiện đã thoả. Giữ nguyên thứ tự đăng ký.
   * Trả true nếu có waiter được đưa vào ready.
   */
  private sweepWaiters(): boolean {
    const still: typeof this.waiters = []
    let woke = false
    for (const w of this.waiters) {
      const done = w.kind === 'children'
        ? (this.tasks.get(w.targetId)?.job.children.every(c => this.isJobSettled(c.id)) ?? true)
        : this.isJobSettled(w.targetId)
      if (!done) { still.push(w); continue }
      // Dùng CHUNG wakeAwaiter với nhánh isJobSettled trong suspend(). Nếu hai
      // chỗ lệch nhau thì "await có ném không" sẽ phụ thuộc vào việc Deferred
      // settled trước hay sau lúc gọi await — sai theo kiểu ngẫu nhiên.
      if (w.kind === 'await') this.wakeAwaiter(w.task, w.targetId)
      else this.ready.push(w.task)
      woke = true
    }
    this.waiters = still
    return woke
  }

  /**
   * Đánh thức một task đang chờ `await` trên `targetId`.
   *
   * `join` và `await` khác nhau đúng ở đây: join chỉ chờ, await ĐỌC kết quả —
   * nên await phải ném lại failure của Deferred tại chính điểm await, kể cả khi
   * supervisor đã chặn failure đó không cho ảnh hưởng tới scope. Đó là lý do
   * `join()` trên một Deferred đã fail im lặng chạy tiếp, còn `await()` thì ném.
   *
   * Hai đường ném, đúng như kotlinx:
   *   - Deferred FAIL  -> ném lại ĐÚNG exception gốc (`failure`).
   *   - Deferred bị CANCEL từ ngoài -> `failure` là null nhưng await vẫn phải
   *     ném CancellationException. Đã đối chiếu Kotlin thật: `d.cancel()` rồi
   *     `d.await()` in "DeferredCoroutine was cancelled", KHÔNG trả Unit. Thiếu
   *     nhánh này thì `println(d.await())` trên Deferred đã huỷ in "kotlin.Unit"
   *     và chương trình chạy tiếp — sai âm thầm, đúng loại lỗi task này sửa.
   * Chỉ khi Deferred kết thúc BÌNH THƯỜNG mới trả giá trị.
   */
  private wakeAwaiter(task: Task, targetId: JobId): void {
    const target = this.tasks.get(targetId)?.job ?? null
    // `cause` chỉ được đọc khi job đã bị huỷ: job chạy xong bình thường không
    // có cause, còn job bị kéo theo vì anh em fail thì cause là exception của
    // kẻ khác — nhưng nó ĐÃ bị cancel, nên vẫn phải ném, không trả giá trị.
    const thrown = target?.failure ?? (target?.isCancelled ? target.cause : null)
    if (thrown) {
      task.resumeThrow = new KotlinThrow(thrown.exType, thrown.message)
    } else if (target?.isCancelled) {
      // Bị huỷ nhưng không ai ghi cause (huỷ trước khi kịp chạy chẳng hạn).
      // Cùng exception tổng hợp mà unwindCancelled dùng, để hai đường thống nhất.
      task.resumeThrow = new KotlinThrow('CancellationException', 'Job was cancelled')
    } else {
      task.resumeValue = target?.result
    }
    this.ready.push(task)
  }

  /** Chạy cho tới khi không còn task ready, không còn waiter thoả, không còn timer. */
  runToCompletion(): void {
    let guard = 0
    for (;;) {
      // Đếm ở CẢ vòng ngoài, không chỉ vòng `ready`. Từ khi tín hiệu huỷ được
      // ném lại ở mọi điểm suspend (đúng như Kotlin), một thân coroutine kiểu
      // `while (true) { try { delay(1) } catch (e: CancellationException) { } }`
      // quay vòng qua unwindCancelled mà KHÔNG bao giờ đi qua `ready` — chốt
      // chỉ nằm ở vòng trong sẽ treo cứng trình duyệt thay vì báo lỗi.
      if (++guard > 100_000) throw new Error('Scheduler: nghi ngờ lặp vô hạn')
      while (this.ready.length > 0) {
        if (++guard > 100_000) throw new Error('Scheduler: nghi ngờ lặp vô hạn')
        this.step(this.ready.shift()!)
      }
      // Cho coroutine đã bị cancel chạy nốt finally trước khi nhảy đồng hồ.
      // Đặt trước sweepWaiters để finally không bị hoãn qua một vòng lặp nữa.
      if (this.unwindCancelled()) continue
      // Quét waiter SAU KHI ready cạn, không quét sau mỗi step. Job vừa xong có
      // thể đã mở khoá một waiter; nếu bỏ dòng này thì đồng hồ sẽ nhảy vượt qua
      // việc vốn đã sẵn sàng chạy. Quét mỗi step vừa thừa vừa tốn.
      if (this.sweepWaiters()) continue
      // Chương trình KẾT THÚC khi coroutine gốc kết thúc, y như JVM thoát ngay
      // sau khi `main` trả về và giết mọi thread daemon.
      //
      // Không có chốt này thì runToCompletion vắt cạn MỌI timer, nên coroutine
      // của GlobalScope (đã thoát khỏi cây job, không ai chờ nó) vẫn in tiếp
      // sau khi chương trình đáng lẽ đã xong — dạy ngược nửa sau của bài học
      // "GlobalScope thoát khỏi structured concurrency": thoát rồi thì cũng
      // KHÔNG được sống lâu hơn chương trình.
      //
      // Đặt SAU unwindCancelled và sweepWaiters, không phải trước: khi root
      // FAIL, task của nó finished ngay trong step() trong khi con vừa bị huỷ
      // còn chưa unwind. Chốt sớm hơn sẽ nuốt mất `finally` của chúng — Kotlin
      // thì runBlocking chờ con unwind xong mới ném ra ngoài. Đã đo: dời chốt
      // lên trước unwindCancelled -> test 'root FAIL vẫn để con chạy nốt
      // finally' ĐỎ ([] thay vì ['cleanup']).
      //
      // CỐ Ý không phát cancel tổng hợp cho những coroutine bị bỏ lại: JVM giết
      // thread daemon mà KHÔNG unwind, nên bịa ra Cancelled sẽ làm `finally`
      // của chúng chạy — sai theo một kiểu khác. Trace để chúng nằm nguyên ở
      // COROUTINE_SUSPENDED không có resume, đúng thứ đã xảy ra thật.
      if (this.rootJobId !== null && this.isJobSettled(this.rootJobId)) break
      this.emitter.setClock(this.clock.now)
      if (!this.clock.advanceToNextTimer()) break
      this.emitter.setClock(this.clock.now)
      // Không quét waiter lại ở đây: callback của timer chỉ đẩy task vào ready,
      // không đổi state job nào, nên không waiter nào có thể vừa được mở khoá.
    }
  }

  /**
   * Ném CancellationException vào các coroutine đã bị cancel nhưng còn đang
   * lửng ở một điểm suspend, để `finally` trong code Kotlin thật sự chạy.
   *
   * Không có bước này thì cancelJob chỉ lật trạng thái Job: generator không
   * bao giờ được resume, nên mọi khối finally im lặng không chạy — đúng thứ
   * mà việc chọn generator đáng ra cho không (xem spec §2.3).
   *
   * Trả true nếu có unwind, để runToCompletion lặp lại trước khi nhảy đồng hồ.
   */
  private unwindCancelled(): boolean {
    let did = false
    for (const task of this.taskOrder) {
      if (task.finished || !task.started) continue
      const governing = this.jobChiPhối(task)
      if (!governing.isCancelled) continue
      if (this.đangChờConCủaScope(task, governing)) continue

      // KHÔNG đặt `finished` ở đây. Unwind có thể kéo dài qua nhiều lượt
      // scheduler (xem `Task.unwinding`), mà `finished` là thứ `isJobSettled`
      // đọc để trả lời "đã dọn dẹp xong chưa" — đặt sớm là đánh thức người chờ
      // trước khi `finally` kịp chạy.
      task.unwinding = true
      did = true
      this.currentJob = task.job
      // Ngăn xếp inline vẫn còn nguyên từ lúc task bị treo: `finally` chạy trên
      // đường unwind nằm BÊN TRONG scope inline nào thì println của nó thuộc về
      // scope ấy, y như khi chạy bình thường.
      this.currentTask = task
      let result: IteratorResult<Suspension, unknown> | null = null
      try {
        // Generator chạy các finally trên đường unwind rồi ném lại.
        //
        // Job FAIL phải nhận lại ĐÚNG exception gốc, không phải một
        // CancellationException tổng hợp. Nếu luôn ném cái tổng hợp thì
        // `try { coroutineScope { launch { throw RuntimeException("boom") } } }
        //  catch (e: RuntimeException) { ... }` không bao giờ khớp, và người
        // học thấy "Job was cancelled" ở đúng chỗ Kotlin thật cho "boom" —
        // tức là công cụ dạy ngược cái khác biệt nó tồn tại để dạy.
        // Job bị CANCEL từ ngoài thì `failure` là null và vẫn nhận
        // CancellationException, đúng như Kotlin.
        const f = governing.failure
        result = task.body.throw(f
          ? new KotlinThrow(f.exType, f.message)
          : new KotlinThrow('CancellationException', 'Job was cancelled'))
      } catch (err) {
        // Generator ném lại exception KOTLIN sau khi finally đã chạy xong —
        // bình thường, không phải lỗi, nuốt đúng.
        //
        // Nhưng `catch` TRẦN thì nuốt cả lỗi bất biến của chính engine ném ra từ
        // một `finally` đang unwind — trong đó có "ngăn xếp inline lệch". Phép
        // kiểm ấy tồn tại để hỏng thật ồn ào; bị nuốt ở đây thì nó thành trang
        // trí, và một exception nội bộ còn THAY THẾ luôn CancellationException
        // đang bay mà không để lại dấu vết nào.
        if (isEngineError(err)) throw err
        // Ném ra được tới đây nghĩa là generator đã unwind XONG.
        task.finished = true
        task.unwinding = false
      } finally {
        this.currentJob = null
        this.currentTask = null
      }
      if (result === null) continue
      // Tới đây thì `body.throw()` TRẢ VỀ chứ không ném: generator đã bắt được
      // tín hiệu huỷ và còn việc phải làm. Bỏ rơi nó ở đây là bỏ luôn mọi
      // `finally` phía sau điểm bắt — đúng cái mà việc chọn generator đáng ra
      // cho không. Đưa nó trở lại đường chạy bình thường của scheduler.
      if (result.done) this.completeTask(task, result.value)
      else this.suspend(task, result.value)
    }
    return did
  }

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

  /**
   * Task đang đỗ ở `joinChildren` CỦA CHÍNH scope inline đang chi phối nó —
   * tức scope ấy đã TỰ biết mình hỏng và đang chờ con chạy hết `finally` trước
   * khi ném lại ở khung người gọi (`runInlineBody`, cả đường thuận lẫn đường
   * `catch`). Đây là "đừng ném lần thứ hai cho cùng một job": tín hiệu huỷ đã
   * ở trong generator rồi, ném thêm lần nữa rơi đúng vào cái `yield
   * joinChildren` đang chờ và CẮT LUÔN việc chờ — người gọi chạy `catch` trước
   * khi con kịp dọn dẹp, đúng lỗi R1 mà M1 đã sửa một lần.
   *
   * Đọc thẳng từ `waiters` chứ không giữ thêm cờ trên Task: `waiters` là mô tả
   * ĐẦY ĐỦ của "đang đỗ ở joinChildren" tại thời điểm này, vì `unwindCancelled`
   * chỉ chạy khi `ready` đã cạn (xem runToCompletion) — không có task nào vừa
   * được đánh thức mà chưa kịp chạy. Cờ song song sẽ ôi thiu ở đúng những
   * đường không ai nhớ cập nhật.
   *
   * `inlineStack.length > 0` là điều kiện thật, không phải cho vui: mọi thân
   * launch/async/root đều kết thúc bằng một `joinChildren` cho CHÍNH job mình.
   * Thiếu nó thì một launch bị huỷ từ ngoài trong lúc chờ con sẽ không bao giờ
   * nhận được tín hiệu huỷ, và người `join()` nó treo vĩnh viễn.
   */
  private đangChờConCủaScope(task: Task, governing: Job): boolean {
    if (task.inlineStack.length === 0) return false
    return this.waiters.some(
      w => w.task === task && w.kind === 'children' && w.targetId === governing.id)
  }

  private step(task: Task): void {
    const { job } = task
    // `task.unwinding` là ngoại lệ có chủ ý của chốt "job xong rồi thì thôi":
    // một generator ĐANG unwind vẫn còn `finally` phải chạy và phần đuôi
    // (`joinChildren` chờ con dọn dẹp) phải hoàn tất, mà job của nó thì đã
    // Cancelled từ trước khi tín hiệu huỷ được ném vào. Chặn ở đây là bỏ rơi
    // generator giữa chừng: `finally` không chạy, `finished` không bao giờ
    // được đặt, và người `join()` nó treo vĩnh viễn.
    if (job.isCompleted && !task.unwinding) return

    const acquired = this.pool.acquire(task.ctx.dispatcher, job.id)
    if (acquired === null) {
      // KHÔNG được bịa ra một thread id ở đây. release() sau đó sẽ giải phóng
      // đúng thread mang id bịa ấy — có thể đang bận chạy job khác — làm hỏng
      // state của pool và sinh THREAD_STATE 'FREE' cho thread thật ra đang chạy.
      // Ở M1 scheduler chạy tuần tự từng task nên pool không bao giờ cạn;
      // nếu cạn thì đó là bất biến bị vỡ, phải chết ngay chứ không hỏng ngầm.
      throw new Error(
        `Scheduler: pool '${task.ctx.dispatcher}' cạn thread khi chạy ${job.id}. ` +
        'Bất biến "mỗi lượt chỉ chạy một task" đã bị vỡ.',
      )
    }
    const threadId = acquired
    this.currentJob = job
    this.currentTask = task

    // DISPATCH nghĩa là ĐỔI dispatcher, không phải "được xếp lịch". Phát khi:
    //  - task vừa qua switchContext (withContext đổi dispatcher), hoặc
    //  - lần chạy đầu tiên của một coroutine có dispatcher khác cha nó.
    // Nếu phát ở mọi lần acquire thì nó trùng lặp COROUTINE_STARTED/RESUMED và
    // mất hẳn ý nghĩa "chỗ này đổi thread".
    //
    // Phải nằm TRƯỚC khối `task.started = true` bên dưới: điều kiện lần-đầu đọc
    // chính cờ đó.
    const pending = this.pendingDispatch.get(task)
    this.pendingDispatch.delete(task)
    if (pending) {
      this.emitter.emit(
        { k: 'DISPATCH', id: pending.jobId, dispatcher: task.ctx.dispatcher, threadId },
        pending.line)
    } else if (!task.started && task.parentDispatcher !== null
               && task.parentDispatcher !== task.ctx.dispatcher) {
      this.emitter.emit({ k: 'DISPATCH', id: job.id, dispatcher: task.ctx.dispatcher, threadId })
    }

    if (!task.started) {
      // `New -> Active` KHÔNG còn xảy ra ở đây từ Task 19: job đã Active ngay
      // lúc `spawn`/`spawnChildOf` tạo ra nó (khớp CoroutineStart.DEFAULT thật
      // của Kotlin). Chỗ này chỉ còn đánh dấu THỰC THI bắt đầu — COROUTINE_STARTED
      // là sự kiện chạy, khác với Active là trạng thái vòng đời; cố tình giữ
      // `task.started` và event này nguyên chỗ cũ, không dời theo Active.
      task.started = true
      this.emitter.emit({ k: 'COROUTINE_STARTED', id: job.id, threadId }, task.startLine)
    } else {
      this.emitter.emit({ k: 'COROUTINE_RESUMED', id: job.id, threadId }, task.resumeLine)
    }
    this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'RUNNING' })

    let result: IteratorResult<Suspension, unknown>
    try {
      // Hai đường resume. Đường `throw` là của `await` trên Deferred đã fail:
      // exception phải nảy ra TỪ TRONG generator, tại đúng dòng gọi await, để
      // try/catch của code Kotlin quanh chỗ đó bắt được. Dọn cả hai trường
      // TRƯỚC khi gọi, kẻo một lần resume sau lại dùng lại giá trị cũ.
      const thrown = task.resumeThrow
      const resumed = task.resumeValue
      task.resumeThrow = undefined
      task.resumeValue = undefined
      result = thrown !== undefined ? task.body.throw(thrown) : task.body.next(resumed)
    } catch (err) {
      task.finished = true
      // Exception đã ra khỏi generator: nếu đây là phần đuôi của một đợt unwind
      // thì đợt ấy kết thúc tại đây.
      task.unwinding = false
      this.pool.release(threadId)
      this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
      this.currentJob = null
      this.currentTask = null
      // Cùng lý do (và cùng cách canh) như failInline: job đã kết thúc RỒI thì
      // đây không phải failure mới, chỉ là cùng một exception đang đi ngược ra
      // qua khung của nó. Ghi lại lần nữa là nhân đôi sự kiện — và tệ hơn, ghi
      // EXCEPTION_THROWN cho một job mà trace vừa tuyên bố là đã chết.
      //
      // job.isCompleted ở ĐÂY khác với lần kiểm ở đầu step(): nó có thể vừa
      // chuyển sang kết thúc TRONG lúc body.next() chạy, do chính thân nó làm
      // failure leo lên qua job này.
      if (job.isCompleted) return
      const cause = toCause(err)
      this.emitter.emit(
        { k: 'EXCEPTION_THROWN', id: job.id, exType: cause.exType, message: cause.message }, cause.line)
      reportFailure(job, cause, this.emitter)
      return
    }

    this.pool.release(threadId)
    this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
    this.currentJob = null
    this.currentTask = null

    if (result.done) {
      this.completeTask(task, result.value)
      return
    }

    this.suspend(task, result.value)
  }

  /**
   * Generator của task đã chạy hết: ghi kết quả rồi đóng job.
   *
   * Dùng CHUNG cho hai đường tới đích — `step()` (đường thuận) và
   * `unwindCancelled` (generator nuốt tín hiệu huỷ rồi chạy nốt tới hết). Hai
   * bản sao của khối này sẽ trôi khỏi nhau, và cái trôi được là thứ im lặng:
   * quên `job.result` thì `await` đọc phải undefined, quên chuyển trạng thái
   * thì job đứng mãi ở Active trong trace.
   */
  private completeTask(task: Task, value: unknown): void {
    const { job } = task
    task.finished = true
    task.unwinding = false
    // Lưu TRƯỚC khi chuyển trạng thái: người chờ được đánh thức theo trạng
    // thái, nên nếu ghi sau thì await có thể đọc phải result còn rỗng.
    job.result = value
    if (!job.isCompleted) {
      job.transitionTo('Completing')
      this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Active', to: 'Completing' })
      job.transitionTo('Completed')
      this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Completing', to: 'Completed' })
    }
  }

  private suspend(task: Task, s: Suspension): void {
    // `switchContext` là điểm nhường quyền KỸ THUẬT (phải trả thread cũ rồi mới
    // lấy được thread mới), KHÔNG phải điểm suspend mà người học cần thấy như
    // delay/await/join. Kotlin cũng không coi withContext là suspend point của
    // coroutine gọi theo nghĩa đó. Phát COROUTINE_SUSPENDED ở đây sẽ nhét thêm
    // một cặp suspended/resumed vào timeline cho MỌI withContext đổi dispatcher,
    // làm nhiễu đúng thứ mà bài học muốn chỉ ra: chỗ đổi thread.
    if (s.s !== 'switchContext') {
      // 'joinChildren' không có trong schema Event — gom về 'join' khi ghi trace.
      const reason = s.s === 'joinChildren' ? 'join' : s.s
      this.emitter.emit({ k: 'COROUTINE_SUSPENDED', id: task.job.id, reason }, s.line)
    }
    // Nhớ chỗ đang treo để lần resume tới trỏ đúng về đây. `joinChildren` do
    // builder tự sinh nên không mang dòng nào — giữ NGUYÊN giá trị cũ thay vì
    // ghi đè bằng undefined, nếu không resume sau một joinChildren sẽ mất dòng.
    if (s.line !== undefined) {
      task.resumeLine = s.line
      task.job.suspendedAtLine = s.line
    }

    switch (s.s) {
      case 'delay':
        this.clock.schedule(this.clock.now + s.ms, () => { this.ready.push(task) })
        break
      case 'yield':
        this.ready.push(task)
        break
      case 'join': {
        // Cùng điều kiện với sweepWaiters — nếu hai chỗ lệch nhau thì join()
        // trả về ngay hay phải chờ sẽ phụ thuộc vào thời điểm ngẫu nhiên.
        if (this.isJobSettled(s.jobId)) { this.ready.push(task); break }
        this.waiters.push({ task, kind: 'join', targetId: s.jobId })
        break
      }
      case 'await': {
        // KHÁC 'join' đúng một chỗ: await đọc kết quả, nên đi qua wakeAwaiter.
        // Deferred đã settled từ trước cũng phải đi đường đó — nếu ở đây dùng
        // ready.push như join thì `await` trên Deferred fail sớm sẽ im lặng
        // trả Unit, còn cùng đoạn code với Deferred fail muộn lại ném.
        if (this.isJobSettled(s.jobId)) { this.wakeAwaiter(task, s.jobId); break }
        this.waiters.push({ task, kind: 'await', targetId: s.jobId })
        break
      }
      case 'joinChildren': {
        const target = this.tasks.get(s.jobId)
        if (!target || target.job.children.every(c => this.isJobSettled(c.id))) {
          this.ready.push(task); break
        }
        this.waiters.push({ task, kind: 'children', targetId: s.jobId })
        break
      }
      case 'switchContext': {
        task.ctx = task.ctx.withDispatcher(s.dispatcher)
        // Thread cũ đã được release ở cuối step(); thread mới sẽ acquire ở step
        // kế. DISPATCH phải mang threadId MỚI, mà threadId chỉ biết được sau khi
        // acquire — nên ghi nợ ở đây, trả ở đầu step() kế.
        this.pendingDispatch.set(task, { jobId: s.jobId, line: s.line })
        this.ready.push(task)
        break
      }
    }
  }

  cancel(job: Job, cause: FailureCause): void {
    cancelJob(job, cause, this.emitter, 'user')
  }

  /**
   * launch/async: tạo child dưới `parentJobId` (lấy từ Env, KHÔNG lấy từ
   * currentJob — xem ghi chú trong Env), chạy sau, xếp cuối hàng ready.
   *
   * Cha ĐÃ KẾT THÚC là ca riêng: con vẫn được TẠO RA (nó là một Job có thật,
   * đọc được `isCancelled`) nhưng bị huỷ ngay và KHÔNG vào hàng ready, nên thân
   * nó không bao giờ chạy. Đã đối chiếu Kotlin thật (2.1.20):
   *
   *   val scope = CoroutineScope(Job()); scope.cancel()
   *   val j = scope.launch { println("BODY"); ... finally { println("FINALLY") } }
   *   -> isCancelled=true, isActive=false, và KHÔNG in gì cả — cả BODY lẫn
   *      FINALLY. Thân chưa từng bắt đầu thì cũng không có gì để unwind. (Đây
   *      chính là lý do Kotlin phải có withContext(NonCancellable) cho dọn dẹp.)
   *
   * Thiếu guard này thì trace sinh ra một hình dạng BẤT KHẢ THI: node cha
   * 'Cancelled' chứa node con 'Completed'. Ngưỡng đó chỉ mở ra từ khi có
   * spawnScopeRoot — trước đó không job nào có thể chết trong khi code còn sinh
   * được con dưới nó, vì `scope.cancel()` chưa huỷ được gì.
   *
   * Cũng đúng cho `finally { launch { } }` bên trong một coroutine đang bị huỷ:
   * cha ở Cancelled nên con mới không chạy — y như Kotlin.
   */
  spawnChildOf(
    parentJobId: JobId | null,
    ctx: CoroutineContext,
    builder: 'launch' | 'async',
    makeBody: (job: Job) => CoroutineBody,
    srcLine?: number,
    startLine?: number,
  ): Job {
    const parent = this.jobById(parentJobId)
    const parentCtx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    const job = this.spawn(parent, false, builder, parentCtx.plus(ctx), makeBody, srcLine, startLine)
    if (parent?.isCompleted) {
      // Rút khỏi ready SAU KHI spawn, không phải thêm cờ vào spawn: COROUTINE_CREATED
      // phải được phát bình thường (con có tồn tại — Kotlin trả về một Job đọc
      // được), chỉ có việc CHẠY là không xảy ra. Tìm theo danh tính chứ không
      // giả định nó là phần tử cuối.
      const i = this.ready.findIndex(t => t.job === job)
      if (i >= 0) this.ready.splice(i, 1)
      // CancellationException tổng hợp, KHÔNG phải `parent.cause`. Đã đo:
      // `scope.async { }.await()` trên scope đã huỷ ném JobCancellationException,
      // không ném lại lý do gốc đã giết scope. Dùng parent.cause ở đây sẽ khiến
      // wakeAwaiter ném ra exception của kẻ khác tại điểm await — sai kiểu tinh vi.
      cancelJob(job, {
        exType: 'CancellationException', message: 'Job was cancelled', isCancellation: true,
      }, this.emitter, parent.id)
    }
    return job
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
    // runBlocking KHÔNG phải scope coroutine: BlockingCoroutine của kotlinx
    // chặn luồng gọi chứ không trả exception vào continuation. Xem Job.isScopeCoroutine.
    const job = new Job(id, merged.name ?? id, parent, isSupervisor, builder !== 'runBlocking')
    parent?.addChild(job)
    const jobCtx = merged.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
    })
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })
    const task: Task = {
      job, ctx: jobCtx, body: (function* (): VoidCoroutineBody { })(), resumeValue: undefined,
      resumeThrow: undefined, started: true, finished: false, unwinding: false, inlineStack: [],
      startLine: undefined, resumeLine: undefined,
      parentDispatcher: parentCtx.dispatcher,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    // KHÔNG push vào ngăn xếp inline ở đây. Việc TẠO job và việc BƯỚC VÀO scope
    // là hai thời điểm khác nhau: giữa chúng, withContext còn yield một điểm đổi
    // dispatcher, và task có thể bị huỷ ngay tại điểm đó. Push ở đây thì cú push
    // ấy nằm NGOÀI try/finally sở hữu cú pop, nên lần huỷ đó rò một job trong
    // ngăn xếp. Người gọi phải tự gọi `enterInline` làm câu lệnh đầu tiên trong
    // chính cái try có `exitInline` ở finally.
    return job
  }

  /**
   * Job GỐC đại diện cho một `CoroutineScope(ctx)`. Không cha, không thân
   * generator, không bao giờ vào hàng ready — nó chỉ là điểm neo cấu trúc để
   * `scope.launch` có cha thật và để SupervisorJob có chỗ mà chặn failure.
   *
   * Không tự Completed: trong Kotlin, scope do user tự dựng sống cho tới khi bị
   * cancel. Nó kết thúc khi `scope.cancel()` được gọi, hoặc không bao giờ.
   *
   * KHÁC spawnInline ở hai chỗ, và cả hai đều cố ý:
   *   - `parent` luôn null. `CoroutineScope(ctx)` KHÔNG treo dưới coroutine bao
   *     quanh — đó chính là lý do nó thoát khỏi structured concurrency của nơi
   *     gọi, và là nửa đầu bài học.
   *   - task mang `finished: true` ngay từ đầu. Không có generator nào để chạy
   *     nên cũng không có gì để unwind: `unwindCancelled` phải BỎ QUA nó (nếu
   *     không, `scope.cancel()` sẽ gọi `.throw()` vào một generator rỗng, tốn
   *     một vòng lặp mà không sinh sự kiện nào), còn `isJobSettled` thì rơi về
   *     đúng câu hỏi duy nhất có nghĩa với job này: state đã kết thúc chưa.
   */
  spawnScopeRoot(ctx: CoroutineContext, isSupervisor: boolean): Job {
    const id = this.newJobId()
    const job = new Job(id, ctx.name ?? id, null, isSupervisor)
    const jobCtx = ctx.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: null, builder: 'scope', ctx: jobCtx.summary(),
    })
    job.transitionTo('Active')
    this.emitter.emit({ k: 'JOB_STATE', id, from: 'New', to: 'Active' })
    const task: Task = {
      job, ctx: jobCtx, body: (function* (): VoidCoroutineBody { })(), resumeValue: undefined,
      resumeThrow: undefined, started: true, finished: true, unwinding: false, inlineStack: [],
      startLine: undefined, resumeLine: undefined,
      parentDispatcher: null,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    return job
  }

  /**
   * BƯỚC VÀO một scope inline: từ đây tới `exitInline`, mọi event nhân danh "job
   * hiện tại" thuộc về scope này chứ không thuộc task bao ngoài.
   *
   * Tách khỏi `spawnInline` và bắt buộc gọi làm câu lệnh ĐẦU TIÊN trong chính
   * cái `try` có `exitInline` ở `finally`. Push ở chỗ khác thì có một cửa sổ
   * trong đó ngăn xếp đã bẩn mà `finally` chưa canh: `withContext` yield điểm
   * đổi dispatcher NGAY SAU khi tạo job, và nếu job bị huỷ tại đúng điểm đó thì
   * `unwindCancelled` ném vào generator TRƯỚC `try` — pop không bao giờ chạy, và
   * mọi println về sau (kể cả `finally` dọn dẹp của người dùng) mang id của một
   * scope chưa từng chạy thân. Đã đo được đúng lỗi ấy trước khi tách.
   */
  enterInline(job: Job): void {
    if (!this.currentTask) {
      throw new Error(
        `Scheduler: enterInline(${job.id}) ngoài lúc chạy một task. Scope inline chỉ ` +
        'tồn tại bên trong thân một coroutine — không có task thì không có ngăn xếp để push.',
      )
    }
    this.currentTask.inlineStack.push(job)
  }

  /**
   * Rời một scope inline. Pop phải đúng job đang ở đỉnh — nếu không khớp, ném
   * lỗi thay vì im lặng, vì lệch ngăn xếp sẽ gán nhầm job cho MỌI println về sau.
   *
   * Gọi từ interpreter trong `finally`, KHÔNG gọi từ completeInline/failInline.
   * Scope inline có BA đường thoát, và đường thứ ba — con của scope fail nên
   * interpreter ném lại tại `if (job.failure)` — không đi qua hàm nào trong hai
   * hàm đó. Đặt pop ở đấy thì ngăn xếp rò đúng ở ca ấy.
   */
  exitInline(job: Job): void {
    const task = this.currentTask
    if (!task) {
      throw new Error(`Scheduler: exitInline(${job.id}) ngoài lúc chạy một task`)
    }
    const top = task.inlineStack.pop()
    if (top !== job) {
      throw new Error(
        `Scheduler: ngăn xếp inline lệch — pop ${job.id} nhưng đỉnh là ${top?.id ?? 'rỗng'}`,
      )
    }
  }

  /**
   * Task của scope inline không có generator thật (thân chạy trong task bao
   * ngoài), nên không đường nào đặt `finished` cho nó. Từ khi người chờ hỏi cả
   * `finished` chứ không chỉ state, bỏ sót bước này sẽ làm joinChildren của cha
   * treo vĩnh viễn trên một scope đã Completed.
   */
  private settleInline(job: Job): void {
    const task = this.tasks.get(job.id)
    if (task) task.finished = true
  }

  completeInline(job: Job): void {
    this.settleInline(job)
    if (job.isCompleted) return
    job.transitionTo('Completing')
    this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Active', to: 'Completing' })
    job.transitionTo('Completed')
    this.emitter.emit({ k: 'JOB_STATE', id: job.id, from: 'Completing', to: 'Completed' })
  }

  /**
   * Đối xứng với completeInline, cho đường THẤT BẠI của scope inline
   * (coroutineScope/supervisorScope/runBlocking/withContext).
   *
   * Không có hàm này thì interpreter chỉ có completeInline để gọi trong
   * `finally`, nghĩa là một exception thoát khỏi thân scope vẫn được ghi vào
   * trace là HOÀN THÀNH THÀNH CÔNG: con của scope không ai huỷ (chạy tiếp như
   * mồ côi), không có FAILURE_PROPAGATED nào, và EXCEPTION_THROWN bị gán cho
   * job bao ngoài chứ không phải cho chính scope.
   */
  failInline(job: Job, cause: FailureCause): void {
    this.settleInline(job)
    // Job đã kết thúc rồi thì đây không phải failure mới — chỉ là cùng một
    // exception đang đi ngược ra qua khung của scope (vd. scope đã bị con của
    // nó kéo chết trước đó). Ghi lại lần nữa là nhân đôi sự kiện.
    if (job.isCompleted) return
    this.emitter.emit({
      k: 'EXCEPTION_THROWN', id: job.id, exType: cause.exType, message: cause.message,
    }, cause.line)
    reportFailure(job, cause, this.emitter)
  }

  cancelById(jobId: JobId, cause: FailureCause): void {
    const task = this.tasks.get(jobId)
    if (task) cancelJob(task.job, cause, this.emitter, 'user')
  }
}
