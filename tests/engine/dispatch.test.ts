import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { Scheduler } from '../../src/engine/runtime/scheduler'
import type { VoidCoroutineBody } from '../../src/engine/runtime/suspension'
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

  it('huỷ rơi đúng điểm đổi dispatcher: cleanup mang job launch, không mang job withContext', () => {
    // Cửa sổ giữa "tạo job scope" và "bước vào scope" là có thật: withContext
    // yield một điểm đổi dispatcher ngay sau khi tạo job, và task nằm trong hàng
    // ready tại đó. Nếu bị huỷ đúng lúc ấy, unwindCancelled ném vào generator
    // NGAY TẠI điểm yield đó — tức TRƯỚC cái try sở hữu cú pop.
    //
    // Đã đo trước khi sửa: `cleanup` mang j4 — job withContext mà thân nó chưa
    // từng chạy — trong khi ca đối chứng ngay dưới cho j2. Push phải nằm bên
    // TRONG try thì cửa sổ ấy mới biến mất.
    const src = `fun main() = runBlocking {
    val j = launch { try { withContext(Dispatchers.IO) { delay(1000) } } finally { println("cleanup") } }
    launch { j.cancel() }
}`
    const r = runSource(src)
    const tạo = createdOf(r.events)
    const launchĐầu = tạo.filter(e => e.builder === 'launch')[0]!
    const wc = tạo.find(e => e.builder === 'withContext')!
    expect(idCủaPrintln(src, 'cleanup')).toBe(launchĐầu.id)
    expect(idCủaPrintln(src, 'cleanup')).not.toBe(wc.id)
  })

  it('đối chứng: cùng chương trình nhưng KHÔNG có withContext cũng cho cùng một id', () => {
    // Không có ca này thì ca trên không chứng minh được gì: phải thấy rằng id
    // đúng là id mà chương trình KHÔNG có scope inline cho ra.
    const src = `fun main() = runBlocking {
    val j = launch { try { delay(1000) } finally { println("cleanup") } }
    launch { j.cancel() }
}`
    const r = runSource(src)
    const launchĐầu = createdOf(r.events).filter(e => e.builder === 'launch')[0]!
    expect(idCủaPrintln(src, 'cleanup')).toBe(launchĐầu.id)
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

  it('DISPATCH mang đúng job và đúng thread ở cả lượt đi lẫn lượt về', () => {
    // Ca trên chỉ kiểm `dispatcher`, nên hoán đổi jobId lượt đi với lượt về vẫn
    // xanh. `id` mới là thứ foldTrace dùng để dời thread của node (world.ts:71-74):
    //  - lượt ĐI đứng tên job withContext — nó là cái được đưa sang IO;
    //  - lượt VỀ đứng tên job GỌI — lúc đó job withContext đã Completed, dời
    //    thread cho một node đã chết là hình dạng bất khả thi.
    const r = runSource(`fun main() = runBlocking {
    withContext(Dispatchers.IO) { println("x") }
}`)
    const gốc = createdOf(r.events)[0]!
    const wc = createdOf(r.events).find(e => e.builder === 'withContext')!
    expect(dispatchOf(r.events).map(e => ({ id: e.id, dispatcher: e.dispatcher, threadId: e.threadId })))
      .toEqual([
        { id: wc.id, dispatcher: 'IO', threadId: 'IO-1' },
        { id: gốc.id, dispatcher: 'Main', threadId: 'Main-1' },
      ])
  })

  it('DISPATCH lượt đi trỏ đúng dòng gọi withContext', () => {
    // Canh trường `line` của suspension switchContext. Bỏ nó đi thì editor mất
    // dòng để tô ở đúng bước đổi thread — bước mà bài học muốn chỉ vào.
    const r = runSource(`fun main() = runBlocking {
    println("trước")
    withContext(Dispatchers.IO) { println("trong") }
}`)
    expect(dispatchOf(r.events)[0]!.srcLine).toBe(3)
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

describe('lỗi bất biến của engine không được nuốt trên đường unwind', () => {
  it('Error ném ra từ finally lúc unwind nổi lên tới người gọi', () => {
    // Phép kiểm "đỉnh ngăn xếp inline phải khớp" (exitInline) chỉ có nghĩa nếu
    // nó ném được RA NGOÀI. unwindCancelled từng bắt bằng `catch` trần, nên một
    // lỗi mất cân bằng ném ra từ `finally` trong lúc unwind sẽ biến mất và còn
    // thay thế luôn CancellationException đang bay.
    //
    // Dựng thẳng trên Scheduler thay vì qua source Kotlin: không có đoạn Kotlin
    // hợp lệ nào làm lệch được ngăn xếp (đó là điểm của cả task này), nên chỉ
    // còn cách bơm thẳng một Error bất biến vào đúng đường đi ấy.
    const s = new Scheduler()
    s.spawnRoot(() => (function* (): VoidCoroutineBody {
      const con = s.spawnChild(function* (): VoidCoroutineBody {
        try {
          yield { s: 'delay', ms: 1000 }
        } finally {
          throw new Error('Scheduler: ngăn xếp inline lệch (giả lập)')
        }
      })
      yield { s: 'delay', ms: 10 }
      s.cancel(con, {
        exType: 'CancellationException', message: 'Job was cancelled', isCancellation: true,
      })
      yield { s: 'delay', ms: 10 }
    })())
    expect(() => { s.runToCompletion() }).toThrow('ngăn xếp inline lệch')
  })

  it('exception KOTLIN ném lại lúc unwind vẫn được nuốt như cũ', () => {
    // Nửa còn lại của hợp đồng: `finally` chạy xong rồi generator ném lại
    // CancellationException là chuyện BÌNH THƯỜNG. Nếu điều kiện lọc quá tay,
    // mọi chương trình có coroutine bị huỷ sẽ nổ.
    const r = runSource(`fun main() = runBlocking {
    val j = launch { try { delay(1000) } finally { println("cleanup") } }
    delay(10)
    j.cancel()
    delay(10)
    println("xong")
}`)
    expect(r.output).toEqual(['cleanup', 'xong'])
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

  it('launch(IO) tạo TRƯỚC khi cha đổi dispatcher vẫn phát DISPATCH của riêng nó', () => {
    // Mốc so sánh là dispatcher của cha LÚC TẠO, không phải lúc con chạy lần
    // đầu. Ở đây cha `withContext(Dispatchers.IO)` NGAY SAU lời gọi launch, và
    // `suspend()` ghi đè `task.ctx` của cha ngay tại điểm yield đó — tức TRƯỚC
    // khi con (đang đứng trước cha trong hàng ready) kịp chạy. Đọc ctx của cha
    // lúc ấy sẽ thấy IO === IO và nuốt mất DISPATCH của con.
    //
    // Đã đo cả hai thiết kế trên chính chương trình này:
    //   chụp-lúc-tạo: [j2->IO, j3->IO, j1->Main]   (j2 = launch con)
    //   đọc-lúc-chạy: [j3->IO, j1->Main]           (j2 biến mất)
    // Kotlin dispatch continuation đầu tiên của con ngay tại chỗ `launch`
    // (CoroutineStart.DEFAULT), nên bản có j2 mới là bản đúng.
    const r = runSource(`fun main() = runBlocking {
    launch(Dispatchers.IO) { delay(10) }
    withContext(Dispatchers.IO) { delay(100) }
}`)
    const con = createdOf(r.events).find(e => e.builder === 'launch')!
    expect(dispatchOf(r.events).map(e => e.id)).toContain(con.id)
  })

  it('launch cùng dispatcher với cha KHÔNG phát DISPATCH', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    expect(dispatchOf(r.events)).toHaveLength(0)
  })
})
