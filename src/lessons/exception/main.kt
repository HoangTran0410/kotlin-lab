import kotlinx.coroutines.*

fun main() = runBlocking {
    val batDuoc = launch {
        try {
            error("boom")
        } catch (e: IllegalStateException) {
            println("1. bắt được exception: " + e.message)
        }
        println("2. job này KHÔNG fail — exception đã được xử lý")
    }
    batDuoc.join()
    println("3. isCancelled = " + batDuoc.isCancelled)

    try {
        coroutineScope {
            launch { throw RuntimeException("không ai bắt") }
        }
    } catch (e: RuntimeException) {
        println("4. exception thoát khỏi coroutine => Job FAIL: " + e.message)
    }
    println("5. hết bài")
}
