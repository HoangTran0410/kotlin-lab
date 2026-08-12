## Mô hình tư duy

Đừng nghĩ `delay()` là "ngủ". Nghĩ nó là **đặt chỗ rồi trả ghế**: coroutine ghi lại
mình đang đứng ở dòng nào, trả thread về pool, và hẹn được gọi lại đúng chỗ đó.
Thread không ngồi chờ ai — nó đi phục vụ coroutine khác ngay lập tức.

Chỗ này sinh ra hai trạng thái mà người mới hay gộp làm một:

- **Coroutine** đang SUSPENDED — thân hàm dừng giữa chừng, không chạy dòng nào.
- **Job** vẫn ACTIVE — nó còn sống, còn nằm trong cây, còn huỷ được, và cha vẫn chờ nó.

## Vì sao Kotlin làm thế

Trình biên dịch cắt mỗi `suspend fun` thành một máy trạng thái: mỗi điểm suspend là
một nhãn để quay lại. Cái "chỗ đang đứng" đó gọi là **continuation**, và nó là một
object trên heap — rẻ hơn một thread thật hàng nghìn lần. Vì vậy chạy mười nghìn
coroutine trên bốn thread là chuyện bình thường.

## Chỗ hay sai

- Tưởng `job.isActive == false` ngay khi coroutine đang `delay`. Không: đang delay
  thì `isActive` vẫn `true`.
- Dùng `Thread.sleep()` thay `delay()`. `sleep` **chặn** thread thật — nó ngồi lên
  ghế và không nhả, cả pool đứng hình.

## Nhìn gì trên đồ thị

Node đổi sang trạng thái nghỉ tại lúc `delay`, nhưng viền của nó **không** đổi sang
màu kết thúc. Badge thread rời khỏi node — thread đã đi chỗ khác.
