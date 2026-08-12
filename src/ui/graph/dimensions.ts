/**
 * Kích thước node là HẰNG SỐ, không đo từ DOM.
 *
 * ELK cần width/height TRƯỚC khi bố cục. Nếu lấy kích thước bằng cách đo text
 * đã render, ta có vòng render → đo → bố cục lại → render, và graph nhảy một
 * khung hình sau mỗi lần render. Đó chính là kiểu rung mà Quyết định 2 tồn tại
 * để chặn. Nhãn dài thì cắt bằng CSS text-overflow, không nới hộp.
 */
export const NODE_W = 200
export const NODE_H = 68
/** Chừa chỗ cho tiêu đề của node compound. */
export const CONTAINER_PADDING = { top: 36, left: 16, right: 16, bottom: 16 }
