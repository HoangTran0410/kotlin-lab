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

// Panel widths AND panel visibility both persist to localStorage, so state
// leaks between cases in the same file unless it is cleared: measured after
// visibility became persistent — one case turned the console on, and the next
// case's click turned it back OFF, so `.shell__right` was null.
//
// Cleared BETWEEN tests only, never inside one: `splitter.test.tsx` has a case
// that unmounts and re-renders on purpose to prove the width survives a
// reopen, and that has to keep working.
beforeEach(() => {
  try { localStorage.clear() } catch { /* private mode */ }
})
