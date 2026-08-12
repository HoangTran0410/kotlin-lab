import type { GraphEdgeSpec } from '../../../engine/trace/graph'

/**
 * 'none'  — cạnh 'child': quan hệ chứa đựng, không phải hành động, nên không
 *           cần mũi tên chỉ hướng.
 * 'arrow' — mũi tên thường, tại đầu TARGET (React Flow đặt marker ở target).
 *           cancel: target = job bị huỷ (luôn NẰM DƯỚI job huỷ nó trong cây,
 *           layout ELK hướng DOWN) -> mũi tên tự nhiên chỉ XUỐNG.
 *           failure: target = job CHA nhận exception (FAILURE_PROPAGATED đi
 *           từ con lên cha, xem propagation.ts) -> mũi tên tự nhiên chỉ LÊN.
 * 'block' — thay mũi tên bằng dấu chặn (đoạn ngang đặc): supervisor đã chặn
 *           failure tại đây, không có gì "lọt qua" để vẽ mũi tên nữa.
 */
export type EdgeMarkerVariant = 'none' | 'arrow' | 'block'

export interface EdgeVisual {
  stroke: string
  strokeWidth: number
  /** SVG stroke-dasharray. undefined ⟺ nét liền. */
  strokeDasharray?: string
  markerVariant: EdgeMarkerVariant
  /** Nhãn tiếng Việt hiện cạnh cạnh. Chỉ có khi bị supervisor chặn. */
  label?: string
}

const CHILD_STYLE: EdgeVisual = { stroke: 'var(--fg-dim)', strokeWidth: 1, markerVariant: 'none' }
const CANCEL_STYLE: EdgeVisual = {
  stroke: 'var(--edge-cancel)', strokeWidth: 2, strokeDasharray: '6 4', markerVariant: 'arrow',
}
const FAILURE_STYLE: EdgeVisual = { stroke: 'var(--state-cancelled)', strokeWidth: 2, markerVariant: 'arrow' }
const FAILURE_BLOCKED_STYLE: EdgeVisual = {
  ...FAILURE_STYLE,
  markerVariant: 'block',
  label: 'bị supervisor chặn',
}

/**
 * Ánh xạ THUẦN kind + blocked -> hình dáng cạnh. Không React, không DOM —
 * GraphCanvas (cạnh 'child'/'cancel', dùng edge mặc định của React Flow) và
 * FailureEdge (cạnh 'failure') đều gọi hàm này, để cả hai nơi vẽ luôn khớp
 * nhau thay vì mỗi nơi tự chọn màu.
 *
 * `blocked` CHỈ có ý nghĩa khi `kind === 'failure'` — 'child' và 'cancel' bỏ
 * qua tham số này hoàn toàn. Đúng với dữ liệu nguồn: buildGraphSpec (Task 4)
 * chỉ gán `blockedBySupervisor` thật cho cạnh 'failure'; cạnh 'child'/'cancel'
 * luôn được tạo với `blocked: false` cứng (xem graph.ts).
 */
export function edgeStyle(kind: GraphEdgeSpec['kind'], blocked: boolean): EdgeVisual {
  switch (kind) {
    case 'child': return CHILD_STYLE
    case 'cancel': return CANCEL_STYLE
    case 'failure': return blocked ? FAILURE_BLOCKED_STYLE : FAILURE_STYLE
  }
}
