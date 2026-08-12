import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('job.isActive / isCancelled / isCompleted đọc trạng thái THẬT', () => {
  it('coroutine đang SUSPENDED thì Job vẫn ACTIVE — lõi của lesson suspend', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        println("A")
        delay(1000)
        println("B")
    }
    delay(10)
    println("đang delay, isActive = " + job.isActive)
    job.join()
    println("xong, isActive = " + job.isActive)
}`)
    expect(r.output).toEqual([
      'A',
      'đang delay, isActive = true',
      'B',
      'xong, isActive = false',
    ])
  })

  it('sau khi cancel: isCancelled true, isActive false, isCompleted true', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(1000) }
    delay(10)
    job.cancelAndJoin()
    println(job.isActive)
    println(job.isCancelled)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true', 'true'])
  })

  it('job xong bình thường: isCancelled false nhưng isCompleted true', () => {
    // Phân biệt hai cái này chính là bài học. Nếu cài sai kiểu "isCompleted =
    // !isActive" thì ca trên vẫn xanh còn ca này đỏ.
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    job.join()
    println(job.isCancelled)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['false', 'true'])
  })

  it('isCompleted false ngay sau launch, trước khi job kịp chạy — phân biệt được với !isActive', () => {
    // Vòng review đầu tiên (Task 4) kết luận sai rằng KHÔNG có ca nào bằng
    // Kotlin nguồn phân biệt được `isCompleted` với `!isActive`, vì lý luận
    // mã Kotlin chỉ quan sát job ở Active/Completed/Cancelled — bỏ sót state
    // `New`: `Scheduler.spawn` (scheduler.ts) đẩy job vào `ready` mà KHÔNG
    // chuyển state; `New -> Active` chỉ xảy ra ở lần step() ĐẦU TIÊN của job
    // đó. `launch` trả về đồng bộ, nên ngay sau `val job = launch { ... }`,
    // TRƯỚC điểm suspend kế tiếp, job vẫn ở `New`.
    //
    // Đối chiếu Kotlin thật (api.kotlinlang.org, cùng chương trình): in
    // "false" rồi "true" — khớp đúng assertion dưới đây. (Engine lệch Kotlin
    // thật ở `isActive` ngay tại điểm này — Kotlin cho true vì
    // CoroutineStart.DEFAULT coi job là Active từ lúc tạo, engine cho false vì
    // chưa step() lần nào — nhưng đó là chuyện của `isActive`, KHÔNG phải của
    // `isCompleted`; ca này cố tình không assert `isActive` để không đóng
    // băng chỗ lệch đó.)
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    println(job.isCompleted)
    job.join()
    println(job.isCompleted)
}`)
    // Đột biến "isCompleted = !isActive" cho ['true', 'true'] (New: isActive
    // false -> !isActive true; SAI dòng đầu).
    expect(r.output).toEqual(['false', 'true'])
  })
})

describe('isActive trần và ensureActive() trong thân coroutine', () => {
  it('vòng lặp isActive dừng khi bị cancel', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        var i = 0
        while (isActive) {
            println("tick " + i)
            i = i + 1
            delay(100)
        }
        println("thoát vòng lặp")
    }
    delay(250)
    job.cancelAndJoin()
    println("đã huỷ")
}`)
    // t=0,100,200 in ba tick; t=250 cancel; vòng lặp không chạy tick thứ tư.
    expect(r.output.filter(l => l.startsWith('tick'))).toEqual(['tick 0', 'tick 1', 'tick 2'])
    expect(r.output[r.output.length - 1]).toBe('đã huỷ')
  })

  it('isActive trần đọc job của coroutine BAO QUANH THEO TỪ VỰNG, không phải job đang chạy', () => {
    // Nếu cài bằng scheduler.currentJob thì sau lần suspend đầu tiên giá trị
    // này trỏ nhầm job và ca trên có thể vẫn xanh trong khi ngữ nghĩa đã sai.
    //
    // Định danh `ngoai` KHÔNG dấu — lexer chỉ nhận [A-Za-z0-9_]. Brief gốc
    // dùng `ngoài` (có dấu), lexer báo lỗi thật (dòng 2 cột 12): "Lexer: ký tự
    // không nhận diện được 'à'". Đây là lỗi trong brief, không phải lỗi cài
    // đặt — đã sửa tên biến, giữ nguyên tiếng Việt có dấu trong string literal.
    const r = runSource(`fun main() = runBlocking {
    val ngoai = launch {
        delay(10)
        launch { delay(500) }
        println("trong launch ngoài: " + isActive)
    }
    ngoai.join()
}`)
    expect(r.output).toEqual(['trong launch ngoài: true'])
  })

  it('isActive trần đọc false sau khi job bị huỷ — không phải true cứng', () => {
    // Vòng review đầu tiên (Task 4) chỉ ra: hai ca isActive-trần ở trên KHÔNG
    // phân biệt được cài đặt thật với `return { t: 'bool', v: true }` cứng —
    // ca "vòng lặp" thoát bằng CancellationException ném thẳng vào generator
    // tại delay() (while (isActive) chưa từng được ĐÁNH GIÁ ra false), còn ca
    // "BAO QUANH THEO TỪ VỰNG" chỉ assert đúng giá trị `true`, cũng là thứ mà
    // nhánh "không tìm thấy job" (env.enclosingJobId === null) trả về.
    //
    // Ca này đọc isActive trần bên trong catch (e: CancellationException) của
    // MỘT job đã bị huỷ — job.isActive lúc đó THẬT SỰ là false. Cùng hình
    // dạng với ca ensureActive() ngay dưới. Đối chiếu Kotlin thật
    // (api.kotlinlang.org): in "caught", "isActive after cancel = false",
    // "done" — khớp đúng assertion dưới đây.
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("bắt được huỷ")
            println("isActive sau huỷ = " + isActive)
        }
    }
    delay(10)
    job.cancelAndJoin()
    println("xong")
}`)
    expect(r.output).toEqual(['bắt được huỷ', 'isActive sau huỷ = false', 'xong'])
  })

  it('ensureActive() ném CancellationException khi job đã bị huỷ', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("bắt được huỷ")
        }
        ensureActive()
        println("không tới đây")
    }
    delay(10)
    job.cancelAndJoin()
    println("xong")
}`)
    expect(r.output).toEqual(['bắt được huỷ', 'xong'])
  })
})
