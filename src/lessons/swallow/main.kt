import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: Exception) {
            println("2. caught an Exception — but this is a CANCELLATION SIGNAL, not an error")
        }
        println("3. the body keeps running even though the coroutine has been cancelled")
    }

    delay(50)
    println("1. call cancelAndJoin()")
    job.cancelAndJoin()
    println("4. job.isCancelled = " + job.isCancelled)
}
