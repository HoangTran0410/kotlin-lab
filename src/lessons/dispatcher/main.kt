import kotlinx.coroutines.*

fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))

    val j = scope.launch {
        println("1. coroutine body runs on the IO pool — inherited from the scope's context")

        withContext(Dispatchers.Default) {
            println("2. withContext switches to the Default pool: still the SAME coroutine, different thread")
        }

        println("3. leaving withContext, back on the IO pool")
    }
    j.join()

    scope.cancel()
    println("4. scope is cancelled — so is every child of it")
}
