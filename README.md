# Kotlin Coroutines Lab

Công cụ học kotlinx.coroutines: viết code Kotlin, xem luồng chạy dưới dạng graph.

**Trạng thái: M1 — engine, chưa có UI.**

Engine biến source Kotlin (subset) thành `Event[]`; `foldTrace(events, n)` dựng lại
trạng thái tại bất kỳ step nào, nên tua ngược được.

    npm install
    npm test

Thiết kế: `docs/superpowers/specs/2026-08-11-kotlin-coroutines-lab-design.md`
Kế hoạch: `docs/superpowers/plans/2026-08-11-m1-engine-core.md`

Mô phỏng deterministic — Kotlin thật có thể interleave khác.
