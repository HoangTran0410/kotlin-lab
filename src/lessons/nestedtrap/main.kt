import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        launch {
            launch { delay(300); println("A xong — không bao giờ in được") }
            launch { delay(50); throw RuntimeException("boom B") }
            launch { delay(300); println("C xong — không bao giờ in được") }
        }
        delay(500)
        println("1. supervisorScope vẫn sống — nhưng nó chỉ cứu được CON TRỰC TIẾP")
    }
    println("2. A và C chết theo P, vì P là Job THƯỜNG nằm giữa")
}
