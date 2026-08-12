import kotlinx.coroutines.*

suspend fun loadImage(): Int {
    delay(200)
    return 2
}

suspend fun loadName(): Int {
    delay(200)
    return 3
}

fun main() = runBlocking {
    println("1. sequential — finish calling this one before moving to the next")
    val a = loadImage()
    val b = loadName()
    println("2. sequential done: " + (a + b))

    println("3. parallel — async starts BOTH before awaiting")
    val image = async { loadImage() }
    val name = async { loadName() }
    println("4. parallel done: " + (image.await() + name.await()))
}
