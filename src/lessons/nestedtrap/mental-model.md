## Mô hình tư duy

Supervisor chỉ chặn failure của **con TRỰC TIẾP**. Chỉ một tầng.

Thêm một `launch` thường vào giữa là bạn đã dựng lại một Job thường ở tầng đó — và
mọi thứ bên dưới nó quay về luật fail-fast. Failure của cháu không bao giờ leo tới
được cầu dao, vì nó đã bị chặn lại và xử lý xong ở người cha thường ngay bên trên.

## Vì sao Kotlin làm thế

Nếu supervisor chặn được failure của **toàn bộ** cây con thì nó sẽ vô hiệu hoá
fail-fast ở mọi tầng bên dưới — kể cả những tầng mà người viết đang cố ý dựa vào
fail-fast. Ranh giới phải cục bộ thì mới ghép được nhiều ranh giới khác nhau trong
cùng một cây.

## Chỗ hay sai

- Bọc `supervisorScope` ở ngoài cùng rồi yên tâm rằng "mọi thứ bên trong đã được cô
  lập". Sai — chỉ tầng con ngay dưới nó được cô lập.
- Muốn cô lập ở tầng sâu thì đặt ranh giới **ở đúng tầng đó**: `supervisorScope`
  bên trong `launch` giữa, chứ không phải ở gốc.

## Nhìn gì trên đồ thị

Tìm node `launch` nằm giữa. Cạnh failure của B dừng lại **ở đó** — nó không đi tiếp
lên supervisor. Rồi từ chính node đó, cancel toả xuống A và C.
