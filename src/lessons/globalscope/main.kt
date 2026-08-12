import kotlinx.coroutines.*

fun main() = runBlocking {
    val inTree = launch {
        delay(100)
        println("2. child IN the tree — runBlocking waits for it before finishing")
    }

    GlobalScope.launch {
        delay(500)
        println("this line never prints — the program ended long ago")
    }

    delay(50)
    println("1. both coroutines run at the same time, but only ONE hangs under runBlocking")
    inTree.join()
    println("3. main is done — the GlobalScope coroutine is left stranded mid-flight")
}
