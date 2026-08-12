import kotlinx.coroutines.*

fun main() = runBlocking {
    val trongCay = launch {
        delay(100)
        println("2. con TRONG cây — runBlocking chờ nó xong mới kết thúc")
    }

    GlobalScope.launch {
        delay(500)
        println("dòng này không bao giờ in — chương trình đã kết thúc từ lâu")
    }

    delay(50)
    println("1. hai coroutine cùng chạy, nhưng chỉ MỘT cái treo dưới runBlocking")
    trongCay.join()
    println("3. main xong — coroutine của GlobalScope bị bỏ lại giữa chừng")
}
