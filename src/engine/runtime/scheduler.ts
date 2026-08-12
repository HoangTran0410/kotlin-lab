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
  /** Đã chạy xong hoặc đã unwind — không được đụng tới generator nữa. */
  finished: boolean
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
  /** Coroutine gốc. Chương trình kết thúc khi nó kết thúc — xem runToCompletion. */
  private rootJobId: JobId | null = null

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

  println(text: string, srcLine?: number): void {
    this.emitter.emit({ k: 'PRINTLN', id: this.currentJob?.id ?? 'j0', text }, srcLine)
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
  ): Job {
    const id = this.newJobId()
    const job = new Job(id, ctx.name ?? id, parent, isSupervisor)
    parent?.addChild(job)

    const jobCtx = ctx.withJob(job)
    this.emitter.emit({
      k: 'COROUTINE_CREATED', id, parentId: parent?.id ?? null, builder, ctx: jobCtx.summary(),
    }, srcLine)

    const task: Task = {
      job, ctx: jobCtx, body: makeBody(job), resumeValue: undefined, resumeThrow: undefined,
      started: false, finished: false,
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
      if (!task.job.isCancelled) continue

      task.finished = true
      did = true
      this.currentJob = task.job
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
        const f = task.job.failure
        task.body.throw(f
          ? new KotlinThrow(f.exType, f.message)
          : new KotlinThrow('CancellationException', 'Job was cancelled'))
      } catch {
        // Bình thường: ném lại sau khi finally đã chạy xong. Không phải lỗi.
      } finally {
        this.currentJob = null
      }
    }
    return did
  }

  private step(task: Task): void {
    const { job } = task
    if (job.isCompleted) return

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
      this.pool.release(threadId)
      this.emitter.emit({ k: 'THREAD_STATE', threadId, state: 'FREE' })
      this.currentJob = null
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

    if (result.done) {
      task.finished = true
      // Lưu TRƯỚC khi chuyển trạng thái: người chờ được đánh thức theo trạng
      // thái, nên nếu ghi sau thì await có thể đọc phải result còn rỗng.
      job.result = result.value
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
    this.emitter.emit({ k: 'COROUTINE_SUSPENDED', id: task.job.id, reason }, s.line)

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
    }
  }

  cancel(job: Job, cause: FailureCause): void {
    cancelJob(job, cause, this.emitter, 'user')
  }

  /**
   * launch/async: tạo child dưới `parentJobId` (lấy từ Env, KHÔNG lấy từ
   * currentJob — xem ghi chú trong Env), chạy sau, xếp cuối hàng ready.
   */
  spawnChildOf(
    parentJobId: JobId | null,
    ctx: CoroutineContext,
    builder: 'launch' | 'async',
    makeBody: (job: Job) => CoroutineBody,
    srcLine?: number,
  ): Job {
    const parent = this.jobById(parentJobId)
    const parentCtx = parent ? this.tasks.get(parent.id)!.ctx : CoroutineContext.empty()
    return this.spawn(parent, false, builder, parentCtx.plus(ctx), makeBody, srcLine)
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
      resumeThrow: undefined, started: true, finished: false,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
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
      resumeThrow: undefined, started: true, finished: true,
    }
    this.tasks.set(id, task)
    this.taskOrder.push(task)
    return job
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
