import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        launch {
            launch { delay(300); println("A done — never gets to print") }
            launch { delay(50); throw RuntimeException("boom B") }
            launch { delay(300); println("C done — never gets to print") }
        }
        delay(500)
        println("1. supervisorScope is still alive — but it only saves its DIRECT CHILD")
    }
    println("2. A and C die along with P, because P is a REGULAR Job sitting in between")
}
