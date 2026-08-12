import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        launch { delay(500); println("A done") }
        launch { delay(100); throw RuntimeException("boom") }
        launch { delay(500); println("C done") }
    }
}
