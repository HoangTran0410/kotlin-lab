import '@testing-library/jest-dom/vitest'

// React Flow đo node bằng ResizeObserver; jsdom không có. Stub tối thiểu để
// component mount được. KHÔNG dùng stub này làm cớ để test hành vi layout ở
// jsdom — layout thật kiểm ở Task 12 (thuần) và Task 20 (Playwright).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
