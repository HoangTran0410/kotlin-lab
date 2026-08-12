## Mô hình tư duy

Hai khối có **thân giống hệt nhau**, khác đúng một từ trong tên hàm, và cho ra hai
kết quả ngược nhau. Đây là bài để thấy rằng thứ quyết định hành vi không nằm trong
code bạn viết ra, mà nằm ở **loại Job của cha**.

- `coroutineScope` → Job thường → con fail thì cả nhóm chết, và lỗi **ném ra cho
  người gọi** (bắt được bằng `try/catch`).
- `supervisorScope` → ranh giới supervisor → con fail thì dừng tại đó, người gọi
  **không thấy gì**.

## Vì sao Kotlin làm thế

Hai nhu cầu thật, đối lập nhau: "tất cả hoặc không gì cả" (tải một trang cần đủ ba
mảnh dữ liệu) và "ai hỏng người nấy chịu" (ba widget độc lập). Cả hai đều đúng, tuỳ
việc — nên Kotlin cho hai hàm, không cho một hàm với một cờ.

## Chỗ hay sai

- Dùng `supervisorScope` chỉ vì không muốn thấy crash. Failure bị nuốt vẫn là
  failure; bạn cần một chỗ để **xử lý** nó, không chỉ một chỗ để nó biến mất.
- Tưởng `try/catch` quanh `supervisorScope` sẽ bắt được lỗi của con. Không có gì
  ném ra ngoài để mà bắt.

## Nhìn gì trên đồ thị

Chạy tới cuối rồi tua ngược: nửa trên có cạnh cancel toả xuống anh em, nửa dưới thì
không. Cùng một hình cây, khác nhau ở đúng những cạnh đó.
