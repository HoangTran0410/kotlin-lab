## Mô hình tư duy

Mỗi coroutine treo dưới một cha, thành một **cái cây**. Cây này có một chiều duy
nhất cho lệnh huỷ: **cancel luôn đi XUỐNG**. Huỷ một node là huỷ cả nhánh bên dưới
nó, tới tận lá. Không có đường nào để cancel đi ngang sang anh em, cũng không có
đường để nó đi ngược lên cha.

Nhớ một câu: *cancel đi xuống, failure đi lên.* Bài này chỉ nói nửa đầu.

## Vì sao Kotlin làm thế

Đây là **structured concurrency**. Nếu coroutine con không có cha, mỗi lần bạn rời
một màn hình là phải tự nhớ huỷ từng tác vụ đã phóng ra — và quên một cái là rò rỉ
một cái. Có cây thì huỷ gốc là xong: không tác vụ nào sống lâu hơn phạm vi đã sinh
ra nó.

## Chỗ hay sai

- Tưởng `cancel()` giết coroutine ngay lập tức. Không: nó **yêu cầu** huỷ. Coroutine
  chỉ thật sự dừng khi chạm điểm suspend kế tiếp — xem bài *Huỷ và dọn dẹp*.
- Tưởng huỷ con thì cha cũng chết theo. Không: huỷ chỉ đi xuống.

## Nhìn gì trên đồ thị

Cạnh cancel màu cam toả từ node bị huỷ xuống **toàn bộ** cây con — mỗi lá một cạnh.
Đó chính là hình ảnh của "đi xuống, tới tận cùng".
