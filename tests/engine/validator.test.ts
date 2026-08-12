import { describe, expect, it } from 'vitest'
import { parseProgram } from '../../src/engine/parser/parser'
import { runSource } from '../../src/engine/run'
import { validate } from '../../src/engine/validator/validator'

const check = (src: string) => validate(parseProgram(src))

describe('validator', () => {
  it('code hợp lệ không sinh chẩn đoán', () => {
    expect(check('fun main() = runBlocking {\n  launch { delay(1) }\n}')).toEqual([])
  })

  it('báo construct chưa hỗ trợ kèm đúng số dòng', () => {
    const d = check('fun main() = runBlocking {\n  val c = Channel<Int>()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(2)
    expect(d[0]!.message).toContain('Channel')
    expect(d[0]!.message).toContain('chưa được hỗ trợ')
  })

  it('gợi ý cách thay thế cho construct chưa hỗ trợ', () => {
    const d = check('fun main() {\n  select { }\n}')
    expect(d[0]!.hint).toBeTruthy()
  })

  it('báo lỗi khi thiếu fun main', () => {
    const d = check('fun other() {\n}')
    expect(d.some(x => x.message.includes('main'))).toBe(true)
  })

  it('gom nhiều lỗi chứ không dừng ở lỗi đầu', () => {
    const d = check('fun main() {\n  Channel<Int>()\n  select { }\n}')
    expect(d.length).toBeGreaterThanOrEqual(2)
  })

  it('nhận diện toán tử Flow chưa hỗ trợ gọi kiểu thành viên', () => {
    // Đường Member là đường DUY NHẤT bắt được buffer/conflate/debounce/
    // combine/zip — 5/13 mục trong danh mục. Phải test bằng một tên THẬT SỰ
    // có trong UNSUPPORTED, và assert đúng mục đó, không phải mục khác lọt vào.
    const d = check('fun main() {\n  flowOf(1).buffer()\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.message).toContain('buffer')
    expect(d[0]!.line).toBe(2)
  })

  it('nhận diện withLock ở dạng gọi thành viên, tách khỏi Mutex', () => {
    const d = check('fun main() {\n  m.withLock { }\n}')
    expect(d.some(x => x.message.includes('withLock'))).toBe(true)
  })

  it('construct HOÃN tới sau M1 được BÁO, không chạy im lặng sai', () => {
    // Hoãn phải nghĩa là ĐƯỢC BÁO. Trước đây mọi lời gọi không nhận ra đều rơi
    // xuống cuối evalCall và trả Unit: `withTimeout(100) { ... }` không chạy gì
    // và cũng không nói gì, `listOf(1).forEach { }` im lặng, `println(j.getCompleted())`
    // in ra chuỗi "kotlin.Unit". Sai lặng lẽ tệ hơn hẳn một lỗi khai báo rõ.
    //
    // isActive/isCancelled/isCompleted/ensureActive KHÔNG còn ở đây — Task 4
    // (M3) đã gỡ chúng khỏi UNSUPPORTED và cài đọc Job thật; test riêng ở
    // tests/engine/job-state.test.ts.
    for (const src of [
      'fun main() = runBlocking {\n  withTimeout(100) { delay(1) }\n}',
      'fun main() = runBlocking {\n  listOf(1).forEach { }\n}',
      'fun main() = runBlocking {\n  println(j.getCompleted())\n}',
      'fun main() = runBlocking {\n  invokeOnCompletion { }\n}',
      'fun main() = runBlocking {\n  NonCancellable\n}',
    ]) {
      const d = check(src)
      expect(d.length, src).toBeGreaterThanOrEqual(1)
      expect(d[0]!.hint, src).toBeTruthy()
      expect(d[0]!.line, src).toBe(2)
    }
  })

  it('repeat KHÔNG bị báo — nó nằm trong subset và đã cài', () => {
    expect(check('fun main() {\n  repeat(3) { println("x") }\n}')).toEqual([])
  })

  it('GlobalScope / cancelAndJoin KHÔNG bị báo — đã cài', () => {
    expect(check(
      'fun main() = runBlocking {\n' +
      '  val j = GlobalScope.launch { delay(1) }\n' +
      '  j.cancelAndJoin()\n' +
      '}')).toEqual([])
  })

  it('chẩn đoán BÊN TRONG string template báo đúng dòng, không phải dòng 1', () => {
    // Node dựng bởi parser lồng của ${...} giữ toạ độ của MẨU (luôn dòng 1),
    // còn validator đọc thẳng pos đó. Hệ quả: mọi chẩn đoán trong template trỏ
    // vào dòng 1 — thường là dòng `fun main()`, chẳng liên quan gì. Dạng không
    // template ngay bên cạnh lại đúng, nên lỗi này rất dễ tưởng là không có.
    const d = check(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(10) }\n' +
      '  println("${j.getCompleted()}")\n' +
      '}')
    expect(d).toHaveLength(1)
    expect(d[0]!.message).toContain('getCompleted')
    expect(d[0]!.line).toBe(3)
    expect(d[0]!.col).toBe(16)
  })

  it('dạng $ident (không ngoặc) trong template cũng báo đúng dòng', () => {
    // NonCancellable (bare ident, không phải Member) thay cho isActive cũ —
    // Task 4 (M3) gỡ isActive khỏi UNSUPPORTED.
    const d = check('fun main() {\n  val x = 1\n  println("a $NonCancellable b")\n}')
    expect(d).toHaveLength(1)
    expect(d[0]!.line).toBe(3)
  })

  it('gom lỗi trên NHIỀU hàm khác nhau, không chỉ trong một hàm', () => {
    const d = check('fun a() {\n  select { }\n}\nfun main() {\n  Channel<Int>()\n}')
    expect(d.map(x => x.line)).toEqual([2, 5])
  })

  describe('isActive trần / ensureActive() ngoài coroutine — Kotlin thật báo unresolved reference', () => {
    // Vòng review Task 4: gỡ isActive/isCancelled/isCompleted/ensureActive
    // khỏi UNSUPPORTED (để chúng đọc Job thật) đã vô tình mở một đường sai âm
    // thầm MỚI — `fun main() { println(isActive) }` không có builder nào bao
    // quanh, Kotlin thật báo lỗi biên dịch ("Unresolved reference"), nhưng
    // trước khi có test này thì validator im lặng và interpreter in "true"
    // (đọc job gốc của runtime, không phải lỗi của người học). Đối chiếu
    // Kotlin thật (api.kotlinlang.org) cho cả `isActive` lẫn `ensureActive()`
    // ngoài mọi builder: cả hai đều "Unresolved reference".
    it('isActive trần ngoài mọi coroutine builder bị báo', () => {
      const d = check('fun main() {\n  println(isActive)\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.message).toContain('isActive')
      expect(d[0]!.line).toBe(2)
    })

    it('ensureActive() ngoài mọi coroutine builder bị báo', () => {
      const d = check('fun main() {\n  ensureActive()\n  println("x")\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.message).toContain('ensureActive')
      expect(d[0]!.line).toBe(2)
    })

    it('isActive trần BÊN TRONG launch/async/runBlocking/coroutineScope/supervisorScope/withContext KHÔNG bị báo', () => {
      for (const src of [
        'fun main() = runBlocking {\n  println(isActive)\n}',
        'fun main() = runBlocking {\n  launch {\n    println(isActive)\n  }\n}',
        'fun main() = runBlocking {\n  val d = async {\n    isActive\n  }\n}',
        'fun main() = runBlocking {\n  coroutineScope {\n    println(isActive)\n  }\n}',
        'fun main() = runBlocking {\n  supervisorScope {\n    println(isActive)\n  }\n}',
        'fun main() = runBlocking {\n  withContext(Dispatchers.IO) {\n    println(isActive)\n  }\n}',
      ]) {
        expect(check(src), src).toEqual([])
      }
    })

    it('cờ inCoroutine XUYÊN QUA khối lồng KHÔNG PHẢI builder (while/try/repeat) bên trong launch', () => {
      // Xác nhận cờ không bị "tắt" oan khi gặp một khối trung gian không phải
      // launch/async/... — while/try/repeat vẫn nằm bên trong coroutine.
      const d = check(
        'fun main() = runBlocking {\n' +
        '  launch {\n' +
        '    repeat(3) {\n' +
        '      while (isActive) {\n' +
        '        try {\n' +
        '          ensureActive()\n' +
        '        } catch (e: Exception) {\n' +
        '        }\n' +
        '      }\n' +
        '    }\n' +
        '  }\n' +
        '}')
      expect(d).toEqual([])
    })

    it('job.isActive dạng THÀNH VIÊN (có receiver) KHÔNG bị đường kiểm coroutine đụng tới', () => {
      // Chỉ isActive TRẦN (không receiver) mới cần CoroutineScope bao quanh.
      // job.isActive đọc trạng thái của MỘT Job cụ thể, hợp lệ ở bất cứ đâu có
      // biến Job — validator không nên báo lỗi ở đây dù đứng ngoài builder.
      const d = check(
        'fun main() = runBlocking {\n' +
        '  val job = launch { delay(1) }\n' +
        '  println(job.isActive)\n' +
        '}')
      expect(d).toEqual([])
    })
  })

  describe('isActive/ensureActive che được bởi biến người học tự khai (Finding 4)', () => {
    // Review vòng 2 của Task 4: đường kiểm coroutine mới (Finding 3) chặn
    // THEO TÊN, không biết gì về bảng ký hiệu — `fun main() { val isActive =
    // true; println(isActive) }` là code HỢP LỆ 100% trên Kotlin thật (đối
    // chiếu api.kotlinlang.org, in "true") nhưng bị validator từ chối. Đúng
    // tiền lệ interpreter.ts:119 đã có (`!env.has('isActive')`) — validator
    // giờ mang theo ngăn xếp tên đã khai (ValDecl/tham số/biến catch/biến for)
    // và chỉ báo lỗi khi tên đó KHÔNG được khai ở scope nào bao quanh.

    it('val isActive tự khai — KHÔNG diagnostic, chạy thật in đúng giá trị', () => {
      const src = 'fun main() {\n  val isActive = true\n  println(isActive)\n}'
      expect(check(src)).toEqual([])
      expect(runSource(src).output).toEqual(['true'])
    })

    it('isActive trần KHÔNG khai gì — CÓ diagnostic đúng dòng, có hint', () => {
      const d = check('fun main() {\n  println(isActive)\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.line).toBe(2)
      expect(d[0]!.hint).toBeTruthy()
    })

    it('val ensureActive tự khai — KHÔNG diagnostic, chạy thật in đúng giá trị', () => {
      const src = 'fun main() {\n  val ensureActive = 42\n  println(ensureActive)\n}'
      expect(check(src)).toEqual([])
      expect(runSource(src).output).toEqual(['42'])
    })

    it('ensureActive() KHÔNG khai gì — CÓ diagnostic đúng dòng, có hint', () => {
      const d = check('fun main() {\n  ensureActive()\n  println("x")\n}')
      expect(d.length).toBeGreaterThanOrEqual(1)
      expect(d[0]!.line).toBe(2)
      expect(d[0]!.hint).toBeTruthy()
    })

    it('biến khai TRONG một block KHÔNG rò ra NGOÀI block đó', () => {
      // Đối chiếu Kotlin thật (api.kotlinlang.org): dòng println ngoài if báo
      // "Unresolved reference 'isActive'" — khớp assertion dưới đây.
      //
      // Đây là ca canh phép phá cụ thể: nếu ngăn xếp scope không pop thật
      // (vd. dùng một Set phẳng dùng chung, không tách theo block) thì tên
      // khai trong if sẽ "rò" ra ngoài, ca này sẽ SAI (không còn diagnostic).
      const d = check(
        'fun main() {\n' +
        '  if (true) {\n' +
        '    val isActive = true\n' +
        '    println(isActive)\n' +
        '  }\n' +
        '  println(isActive)\n' +
        '}')
      expect(d).toHaveLength(1)
      expect(d[0]!.line).toBe(6)
    })
  })
})
