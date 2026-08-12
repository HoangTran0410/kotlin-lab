## Mô hình tư duy

`GlobalScope.launch { }` là một coroutine **không có cha**. Bỏ cha đi thì bạn mất
cả bốn thứ cùng lúc:

- không ai **chờ** nó,
- không ai **huỷ** nó,
- failure của nó không có chỗ nào để đi,
- và nó **không sống lâu hơn tiến trình** — chương trình kết thúc là nó biến mất
  giữa chừng, ngay giữa một `delay`.

Nó không phải "coroutine toàn cục sống mãi". Nó là coroutine **mồ côi**.

## Vì sao Kotlin làm thế

`GlobalScope` được đánh dấu `@DelicateCoroutinesApi` — chính tác giả thư viện coi
nó là công cụ dễ dùng sai. Nó tồn tại cho vài trường hợp cực hiếm ở tầng hạ tầng,
nơi vòng đời thật sự là vòng đời của cả ứng dụng.

Thứ bạn cần gần như luôn là một scope có vòng đời rõ ràng: `viewModelScope`,
`lifecycleScope`, hoặc `CoroutineScope(SupervisorJob())` do chính bạn dựng và chính
bạn `cancel()`.

## Chỗ hay sai

- Dùng `GlobalScope` để "coroutine khỏi bị huỷ khi rời màn hình". Đó chính là rò rỉ:
  nó vẫn chạy, vẫn giữ tham chiếu tới màn hình đã chết.
- Tưởng nó chạy xong rồi mới thoát. Không ai chờ nó cả.

## Nhìn gì trên đồ thị

Nó đứng **riêng một cây**, không có cạnh nào nối lên node `runBlocking`. Và ở bước
cuối cùng, nó vẫn đang ở trạng thái tạm dừng — không bao giờ có bước resume.
