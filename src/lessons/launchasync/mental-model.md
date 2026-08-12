## Mô hình tư duy

Cùng một cơ chế, khác nhau đúng một chỗ: **có ai đọc kết quả không**.

- `launch` → `Job`. `join()` chỉ **chờ**. Không có giá trị nào để lấy, nên cũng
  không có chỗ nào để exception hiện ra cho bạn.
- `async` → `Deferred`. `await()` vừa chờ vừa **đọc**. Và vì có chỗ đọc, exception
  được ném lại **tại đúng dòng gọi `await()`**.

Nên câu hỏi để chọn không phải "cái nào hiện đại hơn" mà là: *tôi có cần giá trị
trả về không?*

## Vì sao Kotlin làm thế

`Deferred` là một lời hứa về một giá trị. Một lời hứa thất bại thì thất bại đó phải
tới tay người đang chờ — như `Promise.reject`. `Job` không hứa gì cả, nên lỗi của nó
chỉ có một đường duy nhất để đi: lên cha.

## Chỗ hay sai

- `async { }` rồi **không** `await()`. Lỗi bên trong sẽ im lặng cho tới khi có ai
  đọc — hoặc mãi mãi.
- Tưởng `await()` là chỗ *duy nhất* lỗi được xử lý. Không: `async` vẫn là con trong
  cây, nên failure vẫn leo lên cha song song với việc chờ được `await()`. Chỗ này là
  lý do bài dùng `supervisorScope`.

## Nhìn gì trên đồ thị

Node `async` giữ trạng thái hỏng của nó suốt một quãng — bạn tua qua từng bước và
thấy nó đã hỏng từ lâu trước khi có ai đọc.
