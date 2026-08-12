import kotlinx.coroutines.*

fun main() = runBlocking {
    val caught = launch {
        try {
            error("boom")
        } catch (e: IllegalStateException) {
            println("1. caught exception: " + e.message)
        }
        println("2. this job does NOT fail — the exception was handled")
    }
    caught.join()
    println("3. isCancelled = " + caught.isCancelled)

    try {
        coroutineScope {
            launch { throw RuntimeException("nobody catches this") }
        }
    } catch (e: RuntimeException) {
        println("4. exception escapes the coroutine => Job FAILS: " + e.message)
    }
    println("5. lesson done")
}
