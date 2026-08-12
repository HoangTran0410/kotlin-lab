import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('huỷ chạm tới delay() trong thân scope inline', () => {
  it('coroutineScope: con fail thì delay của chính thân scope bị cắt ngay', () => {
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            delay(1000)
            println("KHONG duoc in")
        }
    } catch (e: RuntimeException) {
        println("caught: " + e.message)
    }
}`)
    expect(r.output).toEqual(['caught: boom'])
  })

  it('cắt đúng THỜI ĐIỂM, không chỉ đúng nội dung', () => {
    // Nếu chỉ chặn println mà vẫn để đồng hồ ảo chạy hết 1000ms thì output
    // giống hệt ca trên nhưng bài học "dừng NGAY" đã sai.
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { delay(50); throw RuntimeException("boom") }
            delay(1000)
        }
    } catch (e: RuntimeException) { }
    println("xong")
}`)
    const cuối = r.events[r.events.length - 1]!
    expect(cuối.t).toBeLessThan(200)
  })

  it('supervisorScope: con fail bị chặn nên delay của thân KHÔNG bị cắt', () => {
    // Cặp đối chứng. Thiếu ca này thì một bản sửa "cứ có con fail là cắt thân"
    // vẫn làm ca đầu xanh trong khi phá vỡ ngữ nghĩa supervisor.
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        launch { throw RuntimeException("boom") }
        delay(1000)
        println("PHAI in")
    }
}`)
    expect(r.output).toEqual(['PHAI in'])
  })

  it('scope lồng: chỉ scope bị huỷ mới bị cắt, scope ngoài chạy tiếp', () => {
    const r = runSource(`fun main() = runBlocking {
    supervisorScope {
        try {
            coroutineScope {
                launch { throw RuntimeException("trong") }
                delay(1000)
                println("KHONG in")
            }
        } catch (e: RuntimeException) {
            println("bat o scope trong: " + e.message)
        }
        delay(100)
        println("scope ngoai van chay")
    }
}`)
    expect(r.output).toEqual(['bat o scope trong: trong', 'scope ngoai van chay'])
  })

  it('finally trong thân scope vẫn chạy khi bị cắt', () => {
    // Cùng lý do với Task 18 của M1: huỷ phải đi qua đường ném vào generator,
    // không phải đường lật cờ trạng thái.
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            try {
                delay(1000)
            } finally {
                println("don dep")
            }
        }
    } catch (e: RuntimeException) {
        println("caught")
    }
}`)
    expect(r.output).toEqual(['don dep', 'caught'])
  })

  it('scope lồng withContext: người gọi vẫn thấy "boom", không thấy CancellationException', () => {
    // Job của withContext bị cancelJob kéo theo khi anh em fail, nên nó KHÔNG
    // có `failure` và thân nó nhận CancellationException. Nếu coroutineScope
    // bọc ngoài cứ ném lại đúng thứ vừa bay qua thân nó thì cái
    // CancellationException ấy chui ra tới người gọi, `catch (e: RuntimeException)`
    // không khớp và "boom" biến mất — im lặng, output rỗng.
    // Đối chiếu Kotlin thật (api.kotlinlang.org 2.4.10): in đúng "caught: boom".
    const r = runSource(`fun main() = runBlocking {
    try {
        coroutineScope {
            launch { throw RuntimeException("boom") }
            withContext(Dispatchers.IO) {
                delay(1000)
                println("KHONG in")
            }
        }
    } catch (e: RuntimeException) {
        println("caught: " + e.message)
    }
}`)
    expect(r.output).toEqual(['caught: boom'])
  })

  it('nuốt CancellationException rồi suspend tiếp: điểm suspend sau vẫn bị cắt', () => {
    // Kotlin ném CancellationException ở MỌI điểm suspend của coroutine đã huỷ,
    // không phải chỉ điểm đầu tiên. Nếu tín hiệu huỷ chỉ được gửi một lần thì
    // `delay(50)` trong khối catch chạy hết và "sau delay" được in — engine
    // dạy ngược đúng luật quan trọng nhất của cancellation.
    // Đối chiếu Kotlin thật (api.kotlinlang.org 2.4.10): in "xong", "bat".
    const r = runSource(`fun main() = runBlocking {
    val j = launch {
        try {
            delay(1000)
        } catch (e: CancellationException) {
            println("bat")
            delay(50)
            println("sau delay")
        }
    }
    delay(10)
    j.cancel()
    println("xong")
}`)
    expect(r.output).toEqual(['xong', 'bat'])
  })

  it('finally BỌC NGOÀI scope inline chạy được khi huỷ tới từ ngoài', () => {
    // Điểm huỷ thứ ba trong ba điểm mà `finally` của tryBuilder phải bao được:
    // task treo giữa thân scope inline, huỷ tới từ NGOÀI (không phải con fail).
    // Generator bắt tín hiệu rồi `yield joinChildren` để chờ con dọn dẹp, nên
    // `body.throw()` TRẢ VỀ chứ không ném; bỏ rơi nó ở đó thì mọi `finally`
    // phía sau im lặng không chạy và output rỗng.
    // Đối chiếu Kotlin thật (api.kotlinlang.org 2.4.10): in đúng "cleanup".
    const r = runSource(`fun main() = runBlocking {
    val j = launch {
        try {
            coroutineScope { delay(1000) }
        } finally {
            println("cleanup")
        }
    }
    delay(10)
    j.cancel()
}`)
    expect(r.output).toEqual(['cleanup'])
  })
})
