import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        try {
            println("1. open resource")
            delay(1000)
            println("this line never runs")
        } finally {
            println("3. finally STILL runs when cancelled — this is where cleanup happens")
        }
    }

    delay(50)
    println("2. call cancelAndJoin()")
    job.cancelAndJoin()
    println("4. cancelAndJoin() waits for cleanup to finish before continuing")
}
