## Mô hình tư duy

`CoroutineContext` là **một cái túi** chứa các mảnh cấu hình, mỗi loại một mảnh:
Job, Dispatcher, CoroutineName, ExceptionHandler. Cộng bằng `+`, và mảnh **bên phải
ghi đè** mảnh cùng loại bên trái.

Con **thừa kế** túi của cha, rồi chồng thêm phần của riêng nó lên. Còn `withContext`
là cách đổi một mảnh **giữa chừng** rồi tự động trả lại — vẫn cùng một coroutine,
chỉ khác thread.

## Vì sao Kotlin làm thế

Dispatcher không nên là tham số của từng lời gọi, vì nó là chuyện của cả một vùng
code chứ không của một dòng. Cho nó thừa kế theo cây nghĩa là bạn khai báo một lần
ở gốc, và mọi thứ bên dưới tự đúng.

## Chỗ hay sai

- Tưởng `withContext(Dispatchers.IO)` tạo ra coroutine mới. Không — vẫn đúng
  coroutine đó, chỉ đổi thread. Không có node con nào nghĩa là không có ai chạy
  song song với bạn.
- Dùng `Dispatchers.IO` cho việc nặng CPU. IO có pool lớn vì việc IO chỉ nằm chờ;
  việc tính toán nặng thì dùng `Default`.

## Nhìn gì trên đồ thị

Badge thread trên node đổi từ pool này sang pool khác rồi **quay về** — trong khi
node thì vẫn là một node duy nhất từ đầu tới cuối.
