import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: Exception) {
            println("2. bắt được Exception — nhưng đây là TÍN HIỆU HUỶ, không phải lỗi")
        }
        println("3. thân vẫn chạy tiếp dù coroutine đã bị huỷ")
    }

    delay(50)
    println("1. gọi cancelAndJoin()")
    job.cancelAndJoin()
    println("4. job.isCancelled = " + job.isCancelled)
}
