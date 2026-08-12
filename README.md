# Kotlin Coroutines Lab

Công cụ học kotlinx.coroutines: viết code Kotlin, xem luồng chạy dưới dạng graph.

**Trạng thái: M2 — UI chạy thông suốt.**

Engine (M1) biến source Kotlin (subset) thành `Event[]`; `foldTrace(events, n)` dựng
lại trạng thái tại bất kỳ step nào, nên tua ngược được. M2 gắn UI React lên trên:
editor CodeMirror (debounce, highlight dòng đang chạy), panel chẩn đoán với đánh dấu
lỗi ngay trong editor, sơ đồ coroutine bằng React Flow (bố cục ELK một lần cho mỗi
lần biên dịch, không rung khi tua), thanh thời gian kéo được hai chiều kèm nút
phát/tạm dừng, console theo thời gian ảo, và danh sách ba bài học chọn nhanh.

    npm install
    npm run dev      # mở app, chỉnh sửa code Kotlin và tua trace trực tiếp
    npm test          # 427 test: engine (M1) + UI (M2)
    npm run typecheck
    npm run lint
    npm run build     # build production bằng Vite

## Ba bài học

`jobtree`, `normalfail`, `supervisor` — hai bài sau khác nhau **đúng một từ**
(`coroutineScope` vs `supervisorScope`) nhưng cho kết quả khác hẳn, và UI phải làm
khác biệt đó **nhìn thấy được** ở bước cuối của trace: `normalfail` không in dòng
console nào và cả ba coroutine con đều bị huỷ (Cancelled); `supervisor` in đủ hai
dòng (`A xong`, `C xong`) và graph hiện rõ hai coroutine đó Completed, kèm một cạnh
failure có nhãn "bị supervisor chặn" — đúng ranh giới mà `supervisorScope` tạo ra.

Xem `tests/ui/acceptance-m2.test.ts` (khẳng định thuần, headless) và
`tests/ui/acceptance-m2-dom-smoke.test.tsx` (khẳng định trên DOM thật dựng bởi
`<App/>` + store thật, qua jsdom — môi trường phát triển hiện tại không có trình
duyệt thật để chạy Playwright; phần kiểm chứng `boundingBox`/layout CSS thật do đó
còn để ngỏ, xem ghi chú đầu file đó).

Thiết kế: `docs/superpowers/specs/2026-08-11-kotlin-coroutines-lab-design.md`
Kế hoạch M1: `docs/superpowers/plans/2026-08-11-m1-engine-core.md`
Kế hoạch M2: `docs/superpowers/plans/2026-08-12-m2-ui.md`

Mô phỏng deterministic — Kotlin thật có thể interleave khác.
