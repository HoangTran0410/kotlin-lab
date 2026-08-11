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
      }
      // Quét waiter SAU KHI ready cạn, không quét sau mỗi step. Job vừa xong có
      // thể đã mở khoá một waiter; nếu bỏ dòng này thì đồng hồ sẽ nhảy vượt qua
      // việc vốn đã sẵn sàng chạy. Quét mỗi step vừa thừa vừa tốn.
      if (this.sweepWaiters()) continue
      this.emitter.setClock(this.clock.now)
      if (!this.clock.advanceToNextTimer()) break
      this.emitter.setClock(this.clock.now)
      // Không quét waiter lại ở đây: callback của timer chỉ đẩy task vào ready,
      // không đổi state job nào, nên không waiter nào có thể vừa được mở khoá.
    }
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
}
