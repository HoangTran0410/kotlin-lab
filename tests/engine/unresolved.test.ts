import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'
import { LESSONS, loadLessonSource } from '../../src/lessons'

const chan = (src: string) => runSource(src).diagnostics

describe('tên chưa khai báo — "Unresolved reference" của Kotlin thật', () => {
  it('receiver chưa khai báo bị báo, đúng dòng và cột', () => {
    // Ca thật: quên `val supervisorScope = CoroutineScope(SupervisorJob())`.
    // Kotlin thật không biên dịch được. Engine thì dựng một object rác mang
    // đúng cái tên ấy, scopeReceiver không nhận ra, nên lời gọi chạy y hệt
    // `launch { }` trần — cả bài học về supervisor lặng lẽ dạy ngược.
    const d = chan(`import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope.launch { delay(10) }
}`)
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(4)
    expect(d[0]!.col).toBe(5)
    expect(d[0]!.message).toContain('Unresolved reference')
  })

  it('biến chưa khai báo dùng như giá trị cũng bị báo', () => {
    expect(chan('fun main() = runBlocking {\n    println(chuaCo + 1)\n}')).toHaveLength(1)
  })

  it('KHÔNG báo nhầm: biến đã khai, tham số, biến catch/for, `it`, `this`', () => {
    // Mỗi tên ở đây đến từ một đường khai báo khác nhau. Gộp vào một ca vì
    // chúng cùng canh một điều: phép kiểm mới không được chặn code hợp lệ.
    const d = chan(`import kotlinx.coroutines.*

suspend fun lam(scope: CoroutineScope, n: Int) {
    scope.launch { delay(n) }
}

fun main() = runBlocking {
    val bien = 1
    var doiDuoc = 2
    doiDuoc = doiDuoc + bien
    for (i in 1..2) { println(i) }
    repeat(2) { println(it) }
    try { error("x") } catch (e: Exception) { println(e.message) }
    lam(this, doiDuoc)
    println(bien)
}`)
    expect(d).toEqual([])
  })

  it('hàm gọi được trước khi khai báo, và gọi được chính nó', () => {
    expect(chan(`fun main() = runBlocking {
    println(dem(3))
}

fun dem(n: Int): Int = n`)).toEqual([])
  })

  it('tên viết hoa KHÔNG bị hỏi tới — chúng là kiểu/hàm dựng', () => {
    expect(chan(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch(Dispatchers.IO) { throw RuntimeException("x") }
    delay(10)
}`)).toEqual([])
  })

  it('vị trí GỌI không bị báo — hàm chưa biết là chuyện khác', () => {
    // `flowOf` là hàm CÓ THẬT của kotlinx mà engine chưa cài; Flow thuộc
    // milestone sau. Báo nó là "chưa khai báo" sẽ là một câu sai.
    const d = chan('fun main() = runBlocking {\n    flowOf(1)\n}')
    expect(d.filter(x => x.message.includes('Unresolved reference'))).toEqual([])
  })

  it('13 bài và mọi chương trình mẫu vẫn sạch', () => {
    // Đây là thứ canh danh sách TEN_CO_SAN không bị thiếu: bỏ sót một tên dựng
    // sẵn thì có bài đỏ ngay, thay vì lặng lẽ báo nhầm cho người học.
    for (const l of LESSONS) {
      expect(chan(loadLessonSource(l.id)), `bài ${l.id}`).toEqual([])
    }
  })
})

describe('message của exception sống được tới cuối trace', () => {
  it('job hỏng mang cả kiểu LẪN message; job bị huỷ lây thì không', () => {
    // Trước đây message chỉ nằm trong đúng MỘT event (EXCEPTION_THROWN), nên
    // đồ thị hiện "RuntimeException" trần và phải tua trúng event đó mới đọc
    // được "Child 1 failed".
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch { delay(50); throw RuntimeException("Child 1 failed") }
    launch { delay(100); println("không in được") }
}`)
    const w = foldTrace(r.events, r.events.length)
    const jobs = [...w.jobs.values()]
    const hong = jobs.filter(j => j.loi !== null)
    expect(hong).toHaveLength(1)
    expect(hong[0]!.loi).toEqual({ exType: 'RuntimeException', message: 'Child 1 failed' })
    // Anh em bị huỷ lây: có `cause` (kiểu) nhưng KHÔNG có `loi` — nó không ném
    // gì cả. Gán message của người khác cho nó là nói dối trên đồ thị.
    const layNan = jobs.find(j => j.state === 'Cancelled' && j.loi === null)
    expect(layNan, 'không job nào bị huỷ lây?').toBeDefined()
    expect(layNan!.cause).toBe('RuntimeException')
  })
})
