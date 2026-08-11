/**
 * Thiết kế §2.4 và §12: người học rất dễ tưởng thứ tự deterministic này là thứ
 * tự DUY NHẤT khả dĩ. Ghi chú phải THƯỜNG TRỰC — không prop để tắt, không nút
 * đóng, không tự ẩn. Nếu ai đó muốn giấu nó đi thì phải sửa file này và giải
 * thích lý do trong commit.
 *
 * Nó còn gánh thêm phần tồn đọng M1 nhóm A: thứ tự vài event lệch Kotlin thật
 * (catch của scope chạy trước finally của anh em bị huỷ).
 */
export function SimulationNotice() {
  return (
    <div className="sim-notice" role="note">
      <strong>Mô phỏng deterministic.</strong> Công cụ này luôn sinh ra một thứ tự chạy duy nhất
      cho cùng một đoạn code. Kotlin thật chạy đa luồng và có thể xen kẽ khác — nhất là thứ tự
      giữa các coroutine cùng sẵn sàng tại một thời điểm.
    </div>
  )
}
