import kotlinx.coroutines.*

fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))

    val j = scope.launch {
        println("1. thân coroutine chạy trên pool IO — thừa kế từ context của scope")

        withContext(Dispatchers.Default) {
            println("2. withContext đổi sang pool Default: vẫn CÙNG coroutine, khác thread")
        }

        println("3. ra khỏi withContext, quay lại pool IO")
    }
    j.join()

    scope.cancel()
    println("4. scope bị cancel — mọi con của nó cũng vậy")
}
