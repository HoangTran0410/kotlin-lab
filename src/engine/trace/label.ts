/**
 * Tên hiển thị của một job, dùng CHUNG giữa đồ thị và phần diễn giải.
 *
 * Thứ tự ưu tiên, và lý do:
 *
 * 1. `CoroutineName("x")` — người học GÕ RA nó một cách có chủ đích, và nó là
 *    một element thật của CoroutineContext. Cái gì cố ý thì thắng.
 * 2. Tên biến (`val job = launch { }` -> `job`) — thứ người học đang nhìn thấy
 *    trong code của chính mình, nên là cầu nối tự nhiên nhất giữa dòng code và
 *    ô vuông trên đồ thị.
 * 3. Builder (`launch`) — không còn gì khác để gọi.
 *
 * Id (`j4`) KHÔNG nằm ở đây: nó luôn được hiện RIÊNG bên cạnh nhãn, vì ba
 * `launch` không tên phải phân biệt được với nhau ngay cả khi cả ba cùng rơi
 * xuống bậc 3.
 */
export function jobLabel(j: {
  id: string; builder: string; name: string | null; varName?: string | null
}): string {
  return j.name ?? j.varName ?? j.builder
}
