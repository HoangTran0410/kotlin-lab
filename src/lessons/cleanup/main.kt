import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        try {
            println("1. mở tài nguyên")
            delay(1000)
            println("dòng này không bao giờ chạy")
        } finally {
            println("3. finally VẪN chạy khi bị huỷ — đây là chỗ dọn dẹp")
        }
    }

    delay(50)
    println("2. gọi cancelAndJoin()")
    job.cancelAndJoin()
    println("4. cancelAndJoin() chờ dọn dẹp xong mới đi tiếp")
}
