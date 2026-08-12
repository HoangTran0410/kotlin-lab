import kotlinx.coroutines.*

fun main() = runBlocking {
    val parent = launch {
        launch { delay(1000) }
        launch { delay(1000) }
        launch { delay(1000) }
    }
    delay(50)
    parent.cancel()
}
