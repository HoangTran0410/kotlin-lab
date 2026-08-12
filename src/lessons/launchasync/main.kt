import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        val j = launch {
            delay(100)
            println("1. launch finished — it doesn't return any value")
        }
        j.join()
        println("2. join() only WAITS, it can't read anything")

        val d = async {
            delay(100)
            42
        }
        println("3. await() both waits and returns a value: " + d.await())

        val broken = async { throw RuntimeException("boom") }
        delay(50)
        println("4. the Deferred already failed a while ago, but nobody has read it yet so nobody has seen it")
        try {
            broken.await()
            println("this line never runs")
        } catch (e: RuntimeException) {
            println("5. await() throws the exception at the EXACT spot await is called: " + e.message)
        }
    }
    println("6. supervisorScope blocks the async's failure, the program continues")
}
