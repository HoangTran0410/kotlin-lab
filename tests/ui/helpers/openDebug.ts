import { fireEvent, screen } from '@testing-library/react'

/**
 * Mở bảng gỡ lỗi (console + chẩn đoán + diễn giải đầy đủ + timeline từng
 * event).
 *
 * Bảng này mặc định ĐÓNG kể từ khi đồ thị tự mang câu giải thích và nút tua
 * của riêng nó — người học không phải nhìn bốn góc màn hình để hiểu chuyện gì
 * đang xảy ra. Test nào kiểm chính những panel đó thì phải mở ra trước, và
 * việc phải gọi hàm này chính là bằng chứng chúng KHÔNG còn hiện mặc định.
 */
export function openDebug(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ lỗi sâu' }))
}
