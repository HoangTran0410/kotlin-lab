/**
 * Tên hiển thị của một job, dùng CHUNG giữa đồ thị và phần diễn giải.
 *
 * Có `CoroutineName(...)` thì lấy tên đó. Không thì builder kèm id — vì ba
 * `launch` anh em mà cùng hiện đúng chữ "launch" thì câu "launch kết thúc bất
 * thường" không chỉ được vào node nào trên hình.
 */
export function jobLabel(j: { id: string; builder: string; name: string | null }): string {
  return j.name ?? `${j.builder} ${j.id}`
}
