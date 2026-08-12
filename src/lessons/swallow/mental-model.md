## Mô hình tư duy

Tín hiệu huỷ đi trong hệ thống dưới hình dạng **một exception bình thường**:
`CancellationException`. Nó là con của `Exception`. Nên `catch (e: Exception)` bắt
nó — bắt luôn cả lệnh huỷ mà bạn không hề định bắt.

Sau khi nuốt, thân coroutine chạy tiếp như chưa có chuyện gì, trong khi Job thì đã
Cancelled. Hai thứ nói hai câu khác nhau về cùng một coroutine.

## Vì sao Kotlin làm thế

Dùng chính cơ chế exception để mang tín hiệu huỷ là cách để `finally` và
`try/finally` sẵn có tự động chạy đúng — không cần một đường unwind thứ hai song
song với đường của ngôn ngữ. Cái giá phải trả đúng là chỗ này: nó bắt được.

## Chỗ hay sai

- `try { ... } catch (e: Exception) { log(e) }` bọc quanh một khối có điểm suspend.
  Đây là bug im lặng phổ biến nhất khi làm việc với coroutine.
- Bắt hẹp lại vẫn chưa đủ nếu bạn `catch (e: Throwable)`.

Cách đúng: bắt đúng loại lỗi bạn xử lý được, hoặc ném lại khi gặp
`CancellationException`.

## Nhìn gì trên đồ thị

Node đổi sang trạng thái huỷ **trước**, rồi vẫn tiếp tục in ra hai dòng nữa. Trạng
thái và hành vi lệch nhau — chính là thứ khiến bug này khó thấy trong log.
