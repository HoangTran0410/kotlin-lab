import kotlinx.coroutines.*

suspend fun taiAnh(): Int {
    delay(200)
    return 2
}

suspend fun taiTen(): Int {
    delay(200)
    return 3
}

fun main() = runBlocking {
    println("1. tuần tự — gọi xong cái này mới tới cái kia")
    val a = taiAnh()
    val b = taiTen()
    println("2. tuần tự xong: " + (a + b))

    println("3. song song — async khởi động CẢ HAI rồi mới await")
    val anh = async { taiAnh() }
    val ten = async { taiTen() }
    println("4. song song xong: " + (anh.await() + ten.await()))
}
