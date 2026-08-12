import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import type { Event } from '../../src/engine/trace/events'

/**
 * `Event` là union phân phối (`EventBody & {seq,t}`), nên `.find(e => e.k === ...)`
 * KHÔNG thu hẹp kiểu — đọc `.id`/`.dispatcher`/`.threadId` ngay sau đó là lỗi biên
 * dịch. Cùng idiom type-predicate mà scope-root.test.ts dùng.
 */
type Created = Extract<Event, { k: 'COROUTINE_CREATED' }>
type Dispatch = Extract<Event, { k: 'DISPATCH' }>
type ThreadEv = Extract<Event, { k: 'THREAD_STATE' }>
const createdOf = (events: readonly Event[]): Created[] =>
  events.filter((e): e is Created => e.k === 'COROUTINE_CREATED')
const dispatchOf = (events: readonly Event[]): Dispatch[] =>
  events.filter((e): e is Dispatch => e.k === 'DISPATCH')
const threadsOf = (events: readonly Event[]): ThreadEv[] =>
  events.filter((e): e is ThreadEv => e.k === 'THREAD_STATE')

const idCủaPrintln = (src: string, text: string): string => {
  const r = runSource(src)
  const e = r.events.find(x => x.k === 'PRINTLN' && x.text === text)
  if (!e || e.k !== 'PRINTLN') throw new Error(`không tìm thấy println "${text}"`)
  return e.id
}

/**
 * Thread mà một `println` đã chạy trên đó. PRINTLN không mang threadId, nhưng
 * scheduler phát THREAD_STATE 'RUNNING' ở đầu mỗi lượt chạy và 'FREE' ở cuối —
 * nên thread RUNNING gần nhất TRƯỚC dòng in chính là thread đang chạy nó.
 */
const threadKhiIn = (events: readonly Event[], text: string): string => {
  const i = events.findIndex(e => e.k === 'PRINTLN' && e.text === text)
  if (i < 0) throw new Error(`không tìm thấy println "${text}"`)
  for (let n = i; n >= 0; n--) {
    const e = events[n]!
    if (e.k === 'THREAD_STATE' && e.state === 'RUNNING') return e.threadId
  }
  throw new Error(`không có THREAD_STATE RUNNING nào trước println "${text}"`)
}

describe('println gắn đúng job của scope inline bao quanh', () => {
  it('println trong withContext mang id của job withContext, không phải job ngoài', () => {
    const src = `fun main() = runBlocking {
    println("ngoài")
    withContext(Dispatchers.IO) { println("trong") }
}`
    const r = runSource(src)
    const wc = createdOf(r.events).find(e => e.builder === 'withContext')!
    expect(idCủaPrintln(src, 'trong')).toBe(wc.id)
    expect(idCủaPrintln(src, 'ngoài')).not.toBe(wc.id)
  })

  it('println trong coroutineScope mang id của coroutineScope', () => {
    const src = `fun main() = runBlocking {
    coroutineScope { println("trong scope") }
}`
    const r = runSource(src)
    const cs = createdOf(r.events).find(e => e.builder === 'coroutineScope')!
    expect(idCủaPrintln(src, 'trong scope')).toBe(cs.id)
  })

  it('ra khỏi scope thì println gắn lại job ngoài', () => {
    // Canh việc POP ngăn xếp. Nếu chỉ push mà không pop, ca này đỏ.
    const src = `fun main() = runBlocking {
    coroutineScope { println("trong") }
    println("sau")
}`
    const r = runSource(src)
    const gốc = createdOf(r.events)[0]!
    expect(idCủaPrintln(src, 'sau')).toBe(gốc.id)
  })

  it('scope inline ném exception vẫn pop đúng', () => {
    const src = `fun main() = runBlocking {
    try { coroutineScope { throw RuntimeException("boom") } } catch (e: RuntimeException) { }
    println("sau lỗi")
}`
    const r = runSource(src)
    const gốc = createdOf(r.events)[0]!
    expect(idCủaPrintln(src, 'sau lỗi')).toBe(gốc.id)
  })

  it('CON của scope inline fail thì scope vẫn pop đúng', () => {
    // Đường thoát THỨ BA của scope inline, khác hẳn hai ca trên: thân scope
    // KHÔNG ném, mà con của nó fail — interpreter ném lại ở `if (failure)`,
    // một nhánh không đi qua completeInline lẫn failInline. Nếu pop chỉ nằm
    // trong hai hàm đó thì ngăn xếp rò một job và MỌI println về sau mang id
    // của một scope đã chết.
    const src = `fun main() = runBlocking {
    try {
        coroutineScope { launch { throw RuntimeException("boom") } }
    } catch (e: RuntimeException) {
        println("bắt được")
    }
    println("sau lỗi con")
}`
    const r = runSource(src)
    const gốc = createdOf(r.events)[0]!
    expect(idCủaPrintln(src, 'bắt được')).toBe(gốc.id)
    expect(idCủaPrintln(src, 'sau lỗi con')).toBe(gốc.id)
  })

  it('hai coroutine xen kẽ: println của cái này không mang job inline của cái kia', () => {
    const src = `fun main() = runBlocking {
    launch { coroutineScope { delay(50); println("trong scope A") } }
    launch { delay(10); println("B ngoài scope") }
    delay(200)
}`
    const r = runSource(src)
    const a = r.events.find(e => e.k === 'PRINTLN' && e.text === 'trong scope A')!
    const b = r.events.find(e => e.k === 'PRINTLN' && e.text === 'B ngoài scope')!
    const cs = createdOf(r.events).find(e => e.builder === 'coroutineScope')!
    if (a.k !== 'PRINTLN' || b.k !== 'PRINTLN') throw new Error('thiếu println')
    expect(a.id).toBe(cs.id)
    expect(b.id).not.toBe(cs.id)
  })
})

describe('withContext đổi dispatcher thật', () => {
  it('thân withContext chạy trên thread của dispatcher mới', () => {
    const r = runSource(`fun main() = runBlocking {
    println("trên main")
    withContext(Dispatchers.IO) { println("trên IO") }
    println("về main")
}`)
    const threads = new Set(threadsOf(r.events).map(e => e.threadId))
    expect([...threads].some(t => t.startsWith('IO-'))).toBe(true)
    expect([...threads].some(t => t.startsWith('Main-'))).toBe(true)
  })

  it('phát DISPATCH khi vào và khi ra khỏi withContext', () => {
    const r = runSource(`fun main() = runBlocking {
    withContext(Dispatchers.IO) { println("x") }
}`)
    const d = dispatchOf(r.events)
    expect(d.length).toBeGreaterThanOrEqual(2)
    expect(d.some(e => e.dispatcher === 'IO')).toBe(true)
  })

  it('withContext CÙNG dispatcher thì KHÔNG đổi thread và không phát DISPATCH', () => {
    // Kotlin: withContext cùng dispatcher không dispatch lại. Nếu bỏ điều kiện
    // này thì mọi withContext đều sinh DISPATCH rác và bài học "đổi dispatcher"
    // mất hết ý nghĩa.
    const r = runSource(`fun main() = runBlocking {
    withContext(CoroutineName("chỉ đổi tên")) { println("x") }
}`)
    expect(dispatchOf(r.events)).toHaveLength(0)
  })

  it('kết quả của withContext vẫn trả về đúng cho người gọi', () => {
    // Đổi thread không được làm mất giá trị trả về.
    const r = runSource(`fun main() = runBlocking {
    val v = withContext(Dispatchers.IO) { 5 }
    println(v)
}`)
    expect(r.output).toEqual(['5'])
  })

  it('println bên trong withContext vẫn đúng thứ tự so với bên ngoài', () => {
    const r = runSource(`fun main() = runBlocking {
    println("1")
    withContext(Dispatchers.IO) { println("2") }
    println("3")
}`)
    expect(r.output).toEqual(['1', '2', '3'])
  })

  it('mỗi println chạy trên đúng thread của dispatcher đang hiệu lực', () => {
    const r = runSource(`fun main() = runBlocking {
    println("trên main")
    withContext(Dispatchers.IO) { println("trên IO") }
    println("về main")
}`)
    expect(threadKhiIn(r.events, 'trên main')).toMatch(/^Main-/)
    expect(threadKhiIn(r.events, 'trên IO')).toMatch(/^IO-/)
    expect(threadKhiIn(r.events, 'về main')).toMatch(/^Main-/)
  })

  it('thân withContext NÉM thì vẫn đổi dispatcher về chỗ cũ', () => {
    // Đối chiếu Kotlin 2.1.20 (playground): sau khi withContext(Dispatchers.IO)
    // ném, cả `catch` lẫn lệnh sau đó đều chạy trên thread `main`. Nếu đường
    // ném không đi qua `finally { yield switchContext(cũ) }` thì coroutine gọi
    // ở lại IO vĩnh viễn — trace nói runBlocking chạy trên IO-1.
    const r = runSource(`fun main() = runBlocking {
    try {
        withContext(Dispatchers.IO) { println("trong IO"); throw RuntimeException("boom") }
    } catch (e: RuntimeException) {
        println("bắt được")
    }
    println("sau lỗi")
}`)
    expect(threadKhiIn(r.events, 'trong IO')).toMatch(/^IO-/)
    expect(threadKhiIn(r.events, 'bắt được')).toMatch(/^Main-/)
    expect(threadKhiIn(r.events, 'sau lỗi')).toMatch(/^Main-/)
  })
})

describe('DISPATCH khi coroutine con chạy trên dispatcher khác cha', () => {
  it('launch(Dispatchers.IO) từ Main phát DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch(Dispatchers.IO) { delay(10) }
    delay(50)
}`)
    expect(dispatchOf(r.events).some(e => e.dispatcher === 'IO')).toBe(true)
  })

  it('launch cùng dispatcher với cha KHÔNG phát DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    expect(dispatchOf(r.events)).toHaveLength(0)
  })
})
