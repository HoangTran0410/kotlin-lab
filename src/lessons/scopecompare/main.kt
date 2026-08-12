import kotlinx.coroutines.*

fun main() = runBlocking {
    try {
        coroutineScope {
            launch { delay(200); println("A done (coroutineScope)") }
            launch { delay(50); throw RuntimeException("boom") }
        }
    } catch (e: RuntimeException) {
        println("1. coroutineScope: B fails => A is cancelled, the error is thrown to the caller")
    }

    supervisorScope {
        launch { delay(200); println("2. A done (supervisorScope) — still alive") }
        launch { delay(50); throw RuntimeException("boom") }
    }
    println("3. supervisorScope: B's failure is blocked at the boundary, nobody gets cancelled")
}
