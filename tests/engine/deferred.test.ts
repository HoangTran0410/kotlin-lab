import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('async trả giá trị', () => {
  it('await() trả đúng giá trị của biểu thức cuối', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { 42 }
    println(d.await())
}`)
    expect(r.output).toEqual(['42'])
  })

  it('await() trả giá trị sau khi thân async đã suspend', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(100); "xong" }
    println(d.await())
}`)
    expect(r.output).toEqual(['xong'])
  })

  it('hai Deferred độc lập trả đúng giá trị của mình, không lẫn nhau', () => {
    // Ca này bắt lỗi "resumeValue dùng chung": nếu giá trị được ghi vào một chỗ
    // toàn cục thay vì vào đúng task đang chờ, hai kết quả sẽ đổi chỗ hoặc
    // trùng nhau.
    const r = runSource(`fun main() = runBlocking {
    val a = async { delay(200); "A" }
    val b = async { delay(100); "B" }
    println(a.await())
    println(b.await())
}`)
    expect(r.output).toEqual(['A', 'B'])
  })

  it('await() vẫn CHỜ đúng thời điểm, không chỉ trả giá trị', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(300); 7 }
    println(d.await())
}`)
    const in7 = r.events.find(e => e.k === 'PRINTLN')!
    expect(in7.t).toBe(300)
  })

  it('lambda async lấy biểu thức cuối làm giá trị, kể cả khi trước đó có câu lệnh khác', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { println("phu"); 99 }
    println(d.await())
}`)
    expect(r.output).toEqual(['phu', '99'])
  })
})

describe('async giữ failure trong Deferred, ném tại điểm await', () => {
  it('supervisorScope: await() ném dù supervisor chặn failure khỏi scope', () => {
    // Ca QUYẾT ĐỊNH. Trước khi sửa: in "không thấy exception".
    // Kotlin thật: supervisor chặn ảnh hưởng lên scope/sibling, KHÔNG chặn
    // việc đọc trực tiếp một Deferred đã fail.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("boom") }
        delay(50)
        try {
            d.await()
            println("không thấy exception")
        } catch (e: RuntimeException) {
            println("bắt được: " + e.message)
        }
        println("scope chạy tiếp")
    }
}`)
    expect(r.output).toEqual(['bắt được: boom', 'scope chạy tiếp'])
  })

  it('await() trên Deferred đã fail TỪ TRƯỚC vẫn ném (không phải chỉ khi đang treo)', () => {
    // Đường đi khác hẳn: lúc gọi await thì job đã settled, nên scheduler đẩy
    // thẳng vào ready thay vì cho vào waiters. Nếu chỉ cài nhánh waiters thì
    // ca này lọt.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("sớm") }
        delay(200)
        try { d.await(); println("lọt") } catch (e: RuntimeException) { println("bắt: " + e.message) }
    }
}`)
    expect(r.output).toEqual(['bắt: sớm'])
  })

  it('async fail VẪN lan lên cha theo cấu trúc, kể cả khi không ai await', () => {
    // Bảo vệ hành vi đang ĐÚNG khỏi bị task này làm hỏng: sửa await không được
    // biến async thành "failure chỉ tồn tại trong Deferred".
    const r = runSource(`fun main() = runBlocking {
    async { throw RuntimeException("boom") }
    delay(100)
    println("không nên tới đây")
}`)
    expect(r.output).toEqual([])
    expect(r.events.some(e => e.k === 'FAILURE_PROPAGATED')).toBe(true)
  })

  it('await() trên Deferred bị CANCEL ném CancellationException, không trả Unit', () => {
    // Không có trong brief. Đối chiếu Kotlin thật (2.1.20): `d.cancel()` rồi
    // `d.await()` ném "DeferredCoroutine was cancelled". Nếu wakeAwaiter chỉ
    // xét `failure` thì Deferred bị huỷ từ ngoài (failure = null) sẽ im lặng
    // trả Unit và chương trình chạy tiếp — đã ĐO được `"gia tri: kotlin.Unit"`.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { delay(1000); 5 }
        d.cancel()
        try {
            println("gia tri: " + d.await())
        } catch (e: CancellationException) {
            println("await nem CancellationException")
        }
        println("scope chay tiep")
    }
}`)
    expect(r.output).toEqual(['await nem CancellationException', 'scope chay tiep'])
  })

  it('join() KHÔNG ném — chỉ await() mới ném', () => {
    // Khác biệt này là nội dung bài học launchasync.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        val d = async { throw RuntimeException("boom") }
        d.join()
        println("join xong, không ném")
    }
}`)
    expect(r.output).toEqual(['join xong, không ném'])
  })
})
