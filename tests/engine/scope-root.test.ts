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
const createdOf = (events: readonly Event[]): Created[] =>
  events.filter((e): e is Created => e.k === 'COROUTINE_CREATED')
const propagatedOf = (events: readonly Event[]): Propagated[] =>
  events.filter((e): e is Propagated => e.k === 'FAILURE_PROPAGATED')

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
