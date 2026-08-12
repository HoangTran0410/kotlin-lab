## Mô hình tư duy

**Exception** và **failure** là hai chuyện khác nhau.

- *Exception* là một giá trị đang bay lên trong ngăn xếp. Bắt được là hết chuyện.
- *Failure* là trạng thái của một **Job**: nó kết thúc bất thường, và điều đó là
  việc của cha nó.

Một exception chỉ trở thành failure khi nó **thoát ra khỏi thân coroutine**. Bắt
được bên trong thì Job không bao giờ biết có chuyện gì xảy ra.

## Vì sao Kotlin làm thế

Coroutine không có ngăn xếp chung với nơi gọi nó. `launch { }` trả về ngay, nên
không có ai đứng đó để `try/catch` bọc quanh nó. Vì vậy Kotlin cần một đường thứ
hai để chuyển lỗi: đường của **cây job** — thứ mà bài này và ba bài sau nói tới.

## Chỗ hay sai

- `try { launch { throw ... } } catch (e: Exception) { }`. Khối `catch` này **không
  bao giờ** chạy: `launch` đã trả về từ lâu, exception xảy ra ở nơi khác, lúc khác.
  Muốn bắt thì bọc `coroutineScope { }`, hoặc `try/catch` **bên trong** thân launch.
- Tưởng bắt được exception là job "vẫn xanh". Đúng — nhưng chỉ khi bắt **bên trong**.

## Nhìn gì trên đồ thị

Ở nửa đầu: có một câu "bắt được" và không có cạnh failure nào rời khỏi node. Ở nửa
sau: exception thoát ra, và lập tức xuất hiện cạnh failure đi **lên** cha.
