import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        println("1. coroutine starts running")
        delay(1000)
        println("3. resume — still the same coroutine, continuing right from where it stopped")
    }

    delay(10)
    println("2. coroutine is SUSPENDED, but job.isActive = " + job.isActive)

    job.join()
    println("4. done: isActive = " + job.isActive + ", isCompleted = " + job.isCompleted)
}
