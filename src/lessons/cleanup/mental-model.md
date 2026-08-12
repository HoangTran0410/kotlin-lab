## Mô hình tư duy

`cancel()` không phải một phát súng. Nó là **một lá thư**: đánh dấu Job là đang huỷ,
rồi chờ. Lá thư chỉ được đọc khi coroutine chạm điểm suspend kế tiếp (`delay`,
`yield`, `join`, `await`) — lúc đó điểm suspend ấy **ném** `CancellationException`.

Đã là một exception bay lên thì mọi khối `finally` trên đường đi đều chạy. Đó là chỗ
duy nhất bạn được phép tin để đóng file, huỷ đăng ký, trả kết nối.

## Vì sao Kotlin làm thế

Giết một luồng đang chạy giữa chừng là nguồn gốc của tài nguyên rò rỉ và trạng thái
hỏng — đó là lý do `Thread.stop()` bị khai tử. Huỷ **hợp tác** đổi lại: coroutine
được báo, được unwind tử tế, được dọn dẹp.

`cancelAndJoin()` khác `cancel()` đúng ở một chỗ: nó **chờ** phần dọn dẹp chạy xong
rồi mới trả về.

## Chỗ hay sai

- Gọi `cancel()` rồi lập tức đóng tài nguyên dùng chung, tưởng coroutine đã dừng.
  Nó chưa — `finally` của nó có thể chạy **sau** dòng tiếp theo của bạn. Dùng
  `cancelAndJoin()`.
- Gọi hàm suspend trong `finally` để dọn dẹp: coroutine đã bị huỷ nên hàm đó ném
  ngay. (Kotlin thật giải quyết bằng `withContext(NonCancellable)` — chưa có ở đây.)

## Nhìn gì trên đồ thị

Sau cạnh cancel màu cam, node **vẫn in ra** dòng dọn dẹp. Đó là bằng chứng nhìn
thấy được rằng huỷ không phải là chết ngay.
