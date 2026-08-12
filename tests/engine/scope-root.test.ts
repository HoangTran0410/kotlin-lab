import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import type { Event } from '../../src/engine/trace/events'

/**
 * `Event` là union phân phối (`EventBody & {seq,t}`), nên `.filter(e => e.k === ...)`
 * KHÔNG thu hẹp kiểu — `e.builder` sau đó là lỗi biên dịch. Hai hàm dưới đây là
 * cùng phép lọc, viết dạng type predicate để phần thân test đọc thẳng được trường
 * riêng của từng loại sự kiện.
 */
type Created = Extract<Event, { k: 'COROUTINE_CREATED' }>
type Propagated = Extract<Event, { k: 'FAILURE_PROPAGATED' }>
type StateEv = Extract<Event, { k: 'JOB_STATE' }>
const createdOf = (events: readonly Event[]): Created[] =>
  events.filter((e): e is Created => e.k === 'COROUTINE_CREATED')
const propagatedOf = (events: readonly Event[]): Propagated[] =>
  events.filter((e): e is Propagated => e.k === 'FAILURE_PROPAGATED')
const statesOf = (events: readonly Event[]): StateEv[] =>
  events.filter((e): e is StateEv => e.k === 'JOB_STATE')

/**
 * Mọi cặp (cha, con) mà con được TẠO RA khi cha ĐÃ ở trạng thái kết thúc, kèm
 * trạng thái cuối cùng của con.
 *
 * Đây là hình dạng trace mà Kotlin thật không bao giờ sinh ra: gắn coroutine mới
 * vào một Job đã chết thì nó chết theo trước khi thân kịp chạy, nên con KHÔNG
 * BAO GIỜ về 'Completed'. So sánh theo `seq` chứ không theo trạng thái cuối của
 * cha: cha chết SAU khi sinh con là chuyện bình thường và hợp lệ (sibling
 * fail kéo cả nhà xuống), chỉ "chết TRƯỚC khi sinh" mới là thứ bất khả thi.
 */
function childrenBornUnderDeadParent(
  events: readonly Event[],
): { parent: string; child: string; childFinal: string }[] {
  const diedAt = new Map<string, number>()
  for (const e of statesOf(events)) {
    if ((e.to === 'Cancelled' || e.to === 'Completed') && !diedAt.has(e.id)) diedAt.set(e.id, e.seq)
  }
  const finalOf = (id: string): string => {
    const own = statesOf(events).filter(e => e.id === id)
    return own.length > 0 ? own[own.length - 1]!.to : 'New'
  }
  const out: { parent: string; child: string; childFinal: string }[] = []
  for (const c of createdOf(events)) {
    if (c.parentId === null) continue
    const d = diedAt.get(c.parentId)
    if (d !== undefined && d < c.seq) {
      out.push({ parent: c.parentId, child: c.id, childFinal: finalOf(c.id) })
    }
  }
  return out
}

describe('CoroutineScope(ctx) là một Job gốc thật', () => {
  it('scope.launch là CON của scope, không phải job mồ côi', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(10) }
    delay(100)
}`)
    const tạo = createdOf(r.events)
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
    const chặn = propagatedOf(r.events).filter(e => e.blockedBySupervisor)
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
    const tạo = createdOf(r.events)
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

  it('MainScope() cũng là Job gốc, và là SUPERVISOR — không chỉ mỗi Dispatchers.Main', () => {
    // `MainScope()` là pattern Android kinh điển thứ hai (sau
    // `CoroutineScope(SupervisorJob() + Dispatchers.Main)`). Đối chiếu Kotlin
    // thật: `MainScope().coroutineContext[Job]` in ra `SupervisorJobImpl{Active}`
    // và interceptor là `Dispatchers.Main`. Engine trước Task 5 chỉ mang mỗi
    // Dispatchers.Main sang, nên nếu bỏ vế SupervisorJob thì Job gốc dựng ra là
    // Job THƯỜNG và một con fail sẽ giết cả scope — dạy ngược đúng pattern này.
    const r = runSource(`fun main() = runBlocking {
    val scope = MainScope()
    scope.launch { delay(10) }
    delay(100)
}`)
    const tạo = createdOf(r.events)
    const scope = tạo.find(e => e.builder === 'scope')!
    expect(scope).toBeDefined()
    expect(scope.ctx.isSupervisor).toBe(true)
    expect(scope.ctx.dispatcher).toBe('Main')
    const con = tạo.find(e => e.builder === 'launch')!
    expect(con.parentId).toBe(scope.id)
    expect(con.ctx.dispatcher).toBe('Main')
  })

  it('scope đã cancel: launch sau đó KHÔNG chạy thân, job sinh ra đã bị huỷ sẵn', () => {
    // Đối chiếu Kotlin thật (2.1.20), đúng chương trình này:
    //   isCancelled=true / isActive=false / xong
    // Thân lambda KHÔNG in gì. Gắn coroutine mới vào một Job đã huỷ thì nó bị
    // huỷ trước khi thân kịp chạy — cũng chính là lý do Kotlin phải có
    // `withContext(NonCancellable)` cho việc dọn dẹp.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(Job())
    scope.cancel()
    val j = scope.launch { println("KHONG NEN IN") }
    println("isCancelled=" + j.isCancelled)
    println("isActive=" + j.isActive)
    delay(50)
    println("xong")
}`)
    expect(r.output).toEqual(['isCancelled=true', 'isActive=false', 'xong'])

    // Và hình dạng trace phải là thứ Kotlin có thể sinh ra. Trước guard này,
    // engine vẽ ra một node cha 'Cancelled' chứa con 'Completed' — bất khả thi
    // trong Kotlin, và UI thì vẽ đúng cái đó ra màn hình.
    const dưới = childrenBornUnderDeadParent(r.events)
    expect(dưới.length).toBeGreaterThan(0) // chương trình này PHẢI có ca đó...
    expect(dưới.filter(x => x.childFinal === 'Completed')).toEqual([]) // ...và không con nào Completed
  })

  it('cặp đối chứng: scope CHƯA cancel thì launch vẫn chạy bình thường', () => {
    // Nếu guard viết quá tay thành "mọi con của scope đều bị huỷ" thì ca trên
    // vẫn xanh, chỉ ca này đỏ.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(Job())
    val j = scope.launch { println("CO CHAY") }
    delay(50)
    println("isCancelled=" + j.isCancelled)
    println("xong")
}`)
    expect(r.output).toEqual(['CO CHAY', 'isCancelled=false', 'xong'])
  })

  it('scope root KHÔNG bao giờ tự về trạng thái kết thúc khi không ai cancel', () => {
    // Ghim thẳng ngữ nghĩa "scope sống cho tới khi bị cancel" (brief Step 5).
    // Không có ca này thì việc cho scope root tự Completed chỉ bị bắt gián tiếp
    // qua ca `scope.cancel() huỷ mọi con`, và bắt vì lý do khác.
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob())
    scope.launch { delay(10); println("con xong") }
    delay(100)
    println("xong")
}`)
    expect(r.output).toEqual(['con xong', 'xong'])
    const scope = createdOf(r.events).find(e => e.builder === 'scope')!
    const của = statesOf(r.events).filter(e => e.id === scope.id)
    // Có sinh ra và có Active — nếu không thì phép khẳng định dưới đây rỗng tuếch.
    expect(của.map(e => e.to)).toEqual(['Active'])
    // Con của nó thì CÓ về Completed: chứng minh chương trình đã chạy tới nơi,
    // scope root đứng yên không phải vì trace bị cắt ngắn.
    const con = createdOf(r.events).find(e => e.builder === 'launch')!
    expect(statesOf(r.events).some(e => e.id === con.id && e.to === 'Completed')).toBe(true)
  })

  it('dispatcher trong context của scope truyền xuống con', () => {
    const r = runSource(`fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))
    scope.launch { delay(10) }
    delay(100)
}`)
    const con = createdOf(r.events).find(e => e.builder === 'launch')!
    expect(con.ctx.dispatcher).toBe('IO')
    expect(con.ctx.name).toBe('worker')
  })
})
