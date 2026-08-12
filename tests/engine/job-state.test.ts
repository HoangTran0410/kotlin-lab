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
