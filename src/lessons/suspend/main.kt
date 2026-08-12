import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        println("1. coroutine bắt đầu chạy")
        delay(1000)
        println("3. resume — vẫn cùng coroutine đó, chạy tiếp từ đúng chỗ đã dừng")
    }

    delay(10)
    println("2. coroutine đang SUSPENDED, nhưng job.isActive = " + job.isActive)

    job.join()
    println("4. xong rồi: isActive = " + job.isActive + ", isCompleted = " + job.isCompleted)
}
