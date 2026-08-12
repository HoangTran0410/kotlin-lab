/**
 * Kích thước node là HẰNG SỐ, không đo từ DOM.
 *
 * ELK cần width/height TRƯỚC khi bố cục. Nếu lấy kích thước bằng cách đo text
 * đã render, ta có vòng render → đo → bố cục lại → render, và graph nhảy một
 * khung hình sau mỗi lần render. Đó chính là kiểu rung mà Quyết định 2 tồn tại
 * để chặn. Nhãn dài thì cắt bằng CSS text-overflow, không nới hộp.
 */
export const NODE_W = 224
export const NODE_H = 94

/**
 * Chừa chỗ cho tiêu đề của node compound, VÀ cho hai làn cạnh chạy dọc hai
 * bên trong lòng scope.
 *
 * Trái/phải rộng hơn trên/dưới là có chủ ý: cạnh failure đi LÊN dọc mép phải,
 * cạnh cancel đi XUỐNG dọc mép trái (xem GraphCanvas.tsx). Không chừa hai làn
 * này thì đường vòng của chúng bám sát mép hộp và cắt qua node con — đúng
 * hiện tượng "line đè lên node" mà bố cục cũ mắc phải.
 */
export const CONTAINER_PADDING = { top: 44, left: 40, right: 40, bottom: 20 }
