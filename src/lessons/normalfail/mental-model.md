## Mô hình tư duy

Nửa còn lại của câu ở bài *Job Tree*: **failure đi LÊN**.

Một con fail → cha (Job thường) coi như chính nó hỏng → và vì nó hỏng, nó **huỷ mọi
con còn lại** của mình. Nên đường đi thật sự là một chữ V: lên một nấc, rồi toả
xuống tất cả anh em.

Anh em không chết vì lỗi của nhau. Chúng chết vì **cha** đã chết.

## Vì sao Kotlin làm thế

Gọi là **fail-fast**. Nếu bạn phóng ra ba tác vụ để cùng dựng một kết quả, và một
cái hỏng, thì hai cái kia đang làm việc vô ích — tốn thời gian, tốn pin, và có thể
ghi ra dữ liệu nửa vời. Dừng cả nhóm là mặc định an toàn.

Khi *không* muốn thế thì mới dùng supervisor — đó là bài kế tiếp.

## Chỗ hay sai

- Tưởng chỉ coroutine hỏng mới dừng. Không: cả nhóm dừng.
- Tưởng có thể `try/catch` quanh `launch` để giữ anh em sống. Không được — muốn cô
  lập thì phải đổi **cấu trúc** (supervisor), không phải đổi chỗ đặt `catch`.

## Nhìn gì trên đồ thị

Một cạnh failure đỏ đi lên, rồi hai cạnh cancel cam đi xuống hai anh em. Chữ V đó
là toàn bộ bài học.
