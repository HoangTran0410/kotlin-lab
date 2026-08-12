## Mô hình tư duy

Supervisor là một **cầu dao** đặt trên đường failure đi lên. Con fail, tín hiệu leo
lên tới ranh giới supervisor, và dừng ở đó: cha không coi mình là hỏng, nên không
huỷ những con còn lại.

Đúng một chiều bị chặn. Cancel đi xuống thì vẫn đi qua bình thường: huỷ
supervisorScope vẫn huỷ sạch con của nó.

## Vì sao Kotlin làm thế

Có những nhóm việc mà các thành viên **độc lập** với nhau: ba widget trên một màn
hình, năm request tải ảnh. Một cái hỏng không có lý do gì kéo bốn cái kia xuống.
Đó là lúc bạn muốn cô lập failure mà vẫn giữ được lợi ích của cây job (huỷ một
phát là sạch).

## Chỗ hay sai

- Dùng `SupervisorJob()` như một cái khiên vạn năng. Nó chỉ chặn failure của **con
  trực tiếp** — xem bài *Cái bẫy lồng nhau*.
- Truyền `SupervisorJob()` làm đối số cho `launch`: `launch(SupervisorJob())`. Cách
  này tạo một job **rời khỏi** cây thay vì đặt ranh giới supervisor. Ranh giới nằm ở
  `supervisorScope { }` hoặc ở `CoroutineScope(SupervisorJob())`.

## Nhìn gì trên đồ thị

Cạnh failure đi lên và **dừng lại** ở node supervisor — không có cạnh cancel nào
toả ra từ đó. So thẳng với hình của bài trước.
