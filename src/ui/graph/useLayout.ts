import { useEffect, useRef, useState } from 'react'
import type { Compiled } from '../../state/compile'
import { layoutGraph, type LayoutResult } from './elkLayout'

const EMPTY_LAYOUT: LayoutResult = new Map()

/**
 * Chạy `layoutGraph` (ELK, Task 11) trong `useEffect` với dependency
 * **`compiled.revision`** — KHÔNG phải `compiled.spec` (đối tượng MỚI mỗi lần
 * `compile()` chạy dù nội dung giống hệt, so sánh tham chiếu trong mảng deps
 * sẽ luôn coi là đổi) và KHÔNG phải `stepIndex`.
 *
 * Đây là chỗ Quyết định 2 (toReactFlow, Task 12) được THI HÀNH ở tầng hook:
 * `useLabStore.setStep` không đụng tới trường `compiled`, nên tham chiếu
 * `compiled` không đổi khi user kéo timeline — effect này không chạy lại, ELK
 * không chạy lại, graph không rung. Nếu ai đó thêm `stepIndex` vào deps, ELK
 * sẽ chạy lại ở MỖI tick kéo (test 1 dưới đây đếm số lần gọi chính vì thế).
 *
 * ELK là async, còn source recompile theo debounce 250ms trong lúc gõ: một
 * layout chậm của compile A có thể về SAU KHI user đã gõ sang compile B —
 * nếu áp kết quả đó vô điều kiện, graph hiển thị bố cục không khớp với source
 * nào đang hiện trên màn hình. Token tăng dần giữ đúng "cuộc chạy hiện hành";
 * kết quả về muộn hơn token hiện tại (dù vì bị compile mới ghi đè, dù vì
 * unmount) bị VỨT, không setState — cả hai đường đều dùng chung một cơ chế:
 * cleanup của effect (chạy khi deps đổi HOẶC khi unmount) luôn làm token của
 * cuộc chạy vừa rồi thành cũ.
 */
export function useLayout(compiled: Compiled): LayoutResult {
  const [layout, setLayout] = useState<LayoutResult>(EMPTY_LAYOUT)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current

    // Spec rỗng (chưa compile lần nào, hoặc source rỗng): không có gì để bố
    // cục. Trả thẳng map rỗng, không gọi layoutGraph — layoutGraph tự nó đã
    // short-circuit tương tự (elkLayout.ts), nhưng gọi qua Promise vẫn tốn
    // một microtask vô ích ở đúng con đường chạy thường xuyên nhất (mount).
    if (compiled.spec.nodes.length === 0) {
      setLayout(EMPTY_LAYOUT)
      return
    }

    layoutGraph(compiled.spec).then(result => {
      if (token !== tokenRef.current) return // cuộc chạy này đã cũ — vứt
      setLayout(result)
    })

    return () => {
      // Chạy khi deps đổi (compile mới ghi đè) HOẶC khi unmount. Cả hai
      // trường hợp đều có chung ý nghĩa: cuộc chạy vừa rồi không còn là
      // "hiện hành" nữa. Vô hiệu hoá token của nó — nếu promise phía trên
      // resolve sau đó (dù muộn hơn compile mới, dù sau khi đã unmount),
      // nhánh so sánh token ở trên tự loại nó, không setState.
      tokenRef.current += 1
    }
  }, [compiled.revision])

  return layout
}
