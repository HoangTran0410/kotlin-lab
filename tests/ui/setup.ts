import '@testing-library/jest-dom/vitest'

// React Flow measures nodes with ResizeObserver; jsdom doesn't have one. A
// minimal stub so the component can mount. Do NOT use this stub as an excuse
// to test layout behavior under jsdom — real layout is checked in Task 12
// (pure) and Task 20 (Playwright).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
