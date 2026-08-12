import { Handle, Position } from '@xyflow/react'

/**
 * Điểm nối cạnh, dùng chung cho JobNode và ScopeNode.
 *
 * Hai làn riêng cho hai hướng lan truyền, và đó là quyết định DẠY HỌC chứ
 * không phải trang trí:
 *
 *   - failure đi LÊN (con → cha) chạy dọc mép PHẢI
 *   - cancel đi XUỐNG (cha → con) chạy dọc mép TRÁI
 *
 * Bản đầu nối mọi cạnh vào handle đỉnh/đáy giữa hộp. Với đồ thị lồng nhau,
 * một cạnh failure từ node ở tầng sâu lên tổ tiên phải đi ngược chiều bố cục
 * (ELK xếp hướng DOWN), nên React Flow kéo một đường bezier vòng ngược qua
 * giữa mọi thứ nằm chắn đường — chính là các node anh em. Tách hai hướng ra
 * hai mép làm chúng không bao giờ chạy đè lên nhau, và người học đọc được
 * hướng lan truyền chỉ bằng việc nhìn đường đó nằm ở bên nào.
 *
 * `CONTAINER_PADDING` trái/phải (dimensions.ts) chừa sẵn chỗ cho hai làn này
 * bên trong lòng mỗi scope.
 *
 * Mọi handle đều ẩn (graph.css): công cụ này chỉ ĐỌC, không cho kéo để tự nối
 * cạnh mới, nên để lộ chấm kéo thả sẽ gây hiểu lầm là tương tác được.
 */
export function NodePorts() {
  return (
    <>
      <Handle id="in" type="target" position={Position.Top} />
      <Handle id="out" type="source" position={Position.Bottom} />
      <Handle id="fail-out" type="source" position={Position.Right} />
      <Handle id="fail-in" type="target" position={Position.Right} />
      <Handle id="cancel-out" type="source" position={Position.Left} />
      <Handle id="cancel-in" type="target" position={Position.Left} />
    </>
  )
}
