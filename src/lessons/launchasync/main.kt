import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        val j = launch {
            delay(100)
            println("1. launch chạy xong — nó không trả về giá trị nào")
        }
        j.join()
        println("2. join() chỉ CHỜ, không đọc được gì cả")

        val d = async {
            delay(100)
            42
        }
        println("3. await() vừa chờ vừa trả về giá trị: " + d.await())

        val hong = async { throw RuntimeException("boom") }
        delay(50)
        println("4. Deferred đã fail từ lúc nãy, nhưng chưa ai đọc nên chưa ai thấy")
        try {
            hong.await()
            println("dòng này không bao giờ chạy")
        } catch (e: RuntimeException) {
            println("5. await() ném exception ra tại ĐÚNG chỗ gọi await: " + e.message)
        }
    }
    println("6. supervisorScope chặn failure của async, chương trình đi tiếp")
}
