## Mô hình tư duy

`async` **không** làm gì chạy nhanh hơn. Cái làm mọi thứ nhanh hơn là **khoảng cách
giữa chỗ khởi động và chỗ chờ**.

```
val a = async { ... }   ← khởi động
val b = async { ... }   ← khởi động (a vẫn đang chạy)
a.await() + b.await()   ← giờ mới chờ
```

Viết `async { }.await()` liền một dòng là quay về đúng tuần tự — chỉ tốn thêm một
object.

## Vì sao Kotlin làm thế

`async` trả về ngay lập tức, và nó phải như vậy: nếu nó chờ sẵn thì không có cách
nào diễn đạt "chạy hai việc cùng lúc" nữa. Việc quyết định *chờ ở đâu* được để lại
cho người viết — đó chính là chỗ đặt được song song.

## Chỗ hay sai

- `val a = async { ... }.await()` rồi `val b = async { ... }.await()`: tuần tự trá
  hình, và đây là lỗi phổ biến nhất khi mới dùng `async`.
- Bọc mọi thứ trong `async` để "cho nhanh". Với việc đã tuần tự về mặt dữ liệu (b
  cần kết quả của a) thì không có gì để song song cả.

## Nhìn gì trên đồ thị

**Đồng hồ**, không phải output — hai nửa in ra kết quả y hệt nhau. Nửa đầu tốn
400ms, nửa sau tốn 200ms. Kéo dòng thời gian và nhìn hai node `async` chồng nhau
trên cùng một quãng.
