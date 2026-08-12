/**
 * Engine này chạy được những gì — dưới dạng DỮ LIỆU, không phải một trang chữ.
 *
 * Mỗi mục mang theo một chương trình Kotlin chạy được thật và output mà nó
 * PHẢI in ra. `tests/ui/capabilities.test.ts` chạy từng cái một và so từng
 * dòng, nên danh sách này không thể nói dối: một construct bị gỡ khỏi engine
 * mà còn nằm đây thì test đỏ, chứ không phải người học phát hiện ra bằng cách
 * gõ thử rồi thấy không chạy.
 *
 * Đổi lại, mỗi mục cũng là một VÍ DỤ mở được thẳng vào editor — danh sách tính
 * năng và bộ ví dụ là cùng một thứ, không phải hai thứ trôi lệch nhau.
 *
 * Danh sách "chưa chạy được" KHÔNG nằm ở đây: nó suy thẳng từ bảng UNSUPPORTED
 * của validator (xem AboutPanel), nên cũng không trôi lệch được.
 */
export interface KhaNang {
  /** Tên hiện trên thẻ. Gộp vài tên đi liền nhau thì viết cả cụm. */
  ten: string
  /** Một câu: nó làm gì, hoặc nó dạy điều gì. */
  mo: string
  /** Chương trình đầy đủ, chạy được, mở thẳng vào editor được. */
  kotlin: string
  /** Output PHẢI in ra. Test so từng dòng. */
  ra: string[]
}

export interface NhomKhaNang {
  tieuDe: string
  items: KhaNang[]
}

const ct = (than: string): string => `import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n${than}\n}\n`

export const CHAY_DUOC: NhomKhaNang[] = [
  {
    tieuDe: 'Tạo coroutine',
    items: [
      {
        ten: 'launch { }',
        mo: 'Tạo một coroutine con chạy song song, trả về Job. Không mang giá trị về.',
        kotlin: ct(`    val viec = launch {
        delay(50)
        println("con chạy xong")
    }
    println("cha đi tiếp ngay, không chờ")
    viec.join()`),
        ra: ['cha đi tiếp ngay, không chờ', 'con chạy xong'],
      },
      {
        ten: 'async { } / await()',
        mo: 'Như launch nhưng trả về Deferred — await() vừa chờ vừa lấy giá trị.',
        kotlin: ct(`    val so = async {
        delay(50)
        7
    }
    println("await() trả về: " + so.await())`),
        ra: ['await() trả về: 7'],
      },
      {
        ten: 'coroutineScope { }',
        mo: 'Chạy tại chỗ, chỉ trả về khi MỌI con đã xong. Một con fail là cả scope fail.',
        kotlin: ct(`    coroutineScope {
        launch { delay(80); println("A") }
        launch { delay(20); println("B") }
    }
    println("scope trả về khi cả A và B đã xong")`),
        ra: ['B', 'A', 'scope trả về khi cả A và B đã xong'],
      },
      {
        ten: 'supervisorScope { }',
        mo: 'Như coroutineScope, nhưng failure của con TRỰC TIẾP dừng lại ở ranh giới.',
        kotlin: ct(`    supervisorScope {
        launch { delay(20); throw RuntimeException("boom") }
        launch { delay(80); println("anh em vẫn sống") }
    }`),
        ra: ['anh em vẫn sống'],
      },
      {
        ten: 'withContext(...)',
        mo: 'Đổi dispatcher giữa chừng rồi quay lại. Vẫn CÙNG một coroutine.',
        kotlin: ct(`    println("thân runBlocking chạy trên Main")
    withContext(Dispatchers.IO) {
        println("khối này chạy trên pool IO")
    }
    println("ra khỏi withContext là quay lại Main")`),
        ra: [
          'thân runBlocking chạy trên Main',
          'khối này chạy trên pool IO',
          'ra khỏi withContext là quay lại Main',
        ],
      },
      {
        ten: 'CoroutineScope(...) / MainScope()',
        mo: 'Scope tự quản, có Job gốc riêng — không treo dưới coroutine đang gọi.',
        kotlin: ct(`    val pham = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    pham.launch { delay(500); println("không kịp in") }
    delay(50)
    pham.cancel()
    println("cancel() trên scope huỷ mọi con của nó")`),
        ra: ['cancel() trên scope huỷ mọi con của nó'],
      },
      {
        ten: 'GlobalScope.launch { }',
        mo: 'Không cha. Không ai chờ, không ai huỷ, và chết theo chương trình.',
        kotlin: ct(`    GlobalScope.launch { delay(500); println("không bao giờ in") }
    delay(50)
    println("main xong, coroutine kia bị bỏ lại")`),
        ra: ['main xong, coroutine kia bị bỏ lại'],
      },
    ],
  },
  {
    tieuDe: 'Dừng, chờ, huỷ',
    items: [
      {
        ten: 'delay(ms) / yield()',
        mo: 'Hai điểm suspend: nhả thread ra cho người khác dùng, không chặn nó.',
        kotlin: ct(`    launch { println("A1"); yield(); println("A2") }
    launch { println("B1"); yield(); println("B2") }
    delay(10)`),
        ra: ['A1', 'B1', 'A2', 'B2'],
      },
      {
        ten: 'join() / cancel() / cancelAndJoin()',
        mo: 'join chỉ chờ. cancel không chờ. cancelAndJoin huỷ RỒI chờ dọn dẹp xong.',
        kotlin: ct(`    val viec = launch {
        try { delay(500) } finally { println("dọn dẹp") }
    }
    delay(20)
    viec.cancelAndJoin()
    println("chỉ tới đây khi dọn dẹp đã xong")`),
        ra: ['dọn dẹp', 'chỉ tới đây khi dọn dẹp đã xong'],
      },
      {
        ten: 'isActive / isCancelled / isCompleted',
        mo: 'Trạng thái Job đọc được từ code. Coroutine đang SUSPENDED thì Job vẫn Active.',
        kotlin: ct(`    val viec = launch { delay(100) }
    delay(10)
    println("đang delay: isActive = " + viec.isActive)
    viec.join()
    println("xong: isCompleted = " + viec.isCompleted)`),
        ra: ['đang delay: isActive = true', 'xong: isCompleted = true'],
      },
      {
        ten: 'ensureActive()',
        mo: 'Ném ngay tại chỗ nếu đã bị huỷ — không phải chờ tới điểm suspend kế tiếp.',
        kotlin: ct(`    val viec = launch {
        try {
            delay(100)
            ensureActive()
            println("không tới đây")
        } finally { println("finally vẫn chạy") }
    }
    delay(20)
    viec.cancelAndJoin()`),
        ra: ['finally vẫn chạy'],
      },
    ],
  },
  {
    tieuDe: 'Context và dispatcher',
    items: [
      {
        ten: 'Dispatchers.Main / Default / IO / Unconfined',
        mo: 'Bốn pool thread ảo. Con thừa kế dispatcher của cha nếu không nói gì khác.',
        kotlin: ct(`    launch(Dispatchers.Default) { println("Default") }
    launch(Dispatchers.IO) { println("IO") }
    delay(10)`),
        ra: ['Default', 'IO'],
      },
      {
        ten: 'CoroutineName("...")',
        mo: 'Đặt tên cho coroutine. Tên này hiện luôn trên node của đồ thị.',
        kotlin: ct(`    val viec = launch(CoroutineName("thoIn")) { println("nhìn tên node bên phải") }
    viec.join()`),
        ra: ['nhìn tên node bên phải'],
      },
      {
        ten: 'SupervisorJob() / Job() / toán tử +',
        mo: 'Cộng các element lại thành context. Element bên phải ghi đè bên trái.',
        kotlin: ct(`    val pham = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))
    pham.launch { println("thừa kế cả ba element từ scope") }
    delay(10)
    pham.cancel()`),
        ra: ['thừa kế cả ba element từ scope'],
      },
    ],
  },
  {
    tieuDe: 'Kotlin thường',
    items: [
      {
        ten: 'suspend fun',
        mo: 'Hàm gọi được điểm suspend. Gọi nó trông y hệt gọi hàm thường.',
        kotlin: `import kotlinx.coroutines.*

suspend fun tai(ten: String): String {
    delay(50)
    return "xong " + ten
}

fun main() = runBlocking {
    println(tai("anh"))
}
`,
        ra: ['xong anh'],
      },
      {
        ten: 'try / catch / finally, throw, error(...)',
        mo: 'finally chạy cả khi coroutine bị huỷ — đó là chỗ dọn dẹp.',
        kotlin: ct(`    try {
        error("hỏng rồi")
    } catch (e: IllegalStateException) {
        println("bắt được: " + e.message)
    } finally {
        println("finally")
    }`),
        ra: ['bắt được: hỏng rồi', 'finally'],
      },
      {
        ten: 'if / when / while / for / repeat',
        mo: 'for chạy trên khoảng a..b. repeat(n) { } nhận biến it.',
        kotlin: ct(`    for (i in 1..3) {
        val nhan = when (i) {
            1 -> "một"
            2 -> "hai"
            else -> "nhiều"
        }
        println(i.toString() + " = " + nhan)
    }
    repeat(2) { println("lần " + it) }`),
        ra: ['1 = một', '2 = hai', '3 = nhiều', 'lần 0', 'lần 1'],
      },
      {
        ten: 'val / var, chuỗi mẫu ${...}',
        mo: 'Biến, phép toán số nguyên, và chèn biểu thức vào chuỗi.',
        kotlin: ct(`    val a = 6
    var b = 7
    b = b + 1
    println("\${a} x \${b} = \${a * b}")`),
        ra: ['6 x 8 = 48'],
      },
    ],
  },
]
