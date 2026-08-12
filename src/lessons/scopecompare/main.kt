import kotlinx.coroutines.*

fun main() = runBlocking {
    try {
        coroutineScope {
            launch { delay(200); println("A xong (coroutineScope)") }
            launch { delay(50); throw RuntimeException("boom") }
        }
    } catch (e: RuntimeException) {
        println("1. coroutineScope: B fail => A bị huỷ, lỗi ném ra cho người gọi")
    }

    supervisorScope {
        launch { delay(200); println("2. A xong (supervisorScope) — vẫn sống") }
        launch { delay(50); throw RuntimeException("boom") }
    }
    println("3. supervisorScope: B fail bị chặn tại ranh giới, không ai bị huỷ")
}
