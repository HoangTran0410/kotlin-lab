import { useCallback, useEffect, useState } from 'react'

export const MIN_LEFT = 260
export const MAX_LEFT = 900
export const MIN_RIGHT = 280
export const MAX_RIGHT = 800

const STORAGE_KEY = 'kcl.panels.v1'

interface Widths { left: number; right: number }

/** Noticeably wider than the old fixed value (320px): a cramped code column was the #1 complaint. */
const DEFAULT_WIDTHS: Widths = { left: 460, right: 400 }

function read(): Widths {
  // localStorage is data outside our control: users edit it by hand, an old
  // version wrote a different shape, private mode throws on read. On failure,
  // fall back to the default — a width number is never worth a blank screen.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIDTHS
    const v = JSON.parse(raw) as Partial<Widths>
    const num = (x: unknown, fallback: number, min: number, max: number): number =>
      typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback
    return {
      left: num(v.left, DEFAULT_WIDTHS.left, MIN_LEFT, MAX_LEFT),
      right: num(v.right, DEFAULT_WIDTHS.right, MIN_RIGHT, MAX_RIGHT),
    }
  } catch {
    return DEFAULT_WIDTHS
  }
}

/**
 * Widths of the two side columns, draggable and remembered across sessions.
 *
 * Widths used to be a constant in CSS, so the code column was always cramped
 * to exactly one size no matter how wide the screen was or whether the
 * learner was reading long or short code.
 */
export function usePanelWidths() {
  const [widths, setWidths] = useState<Widths>(read)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)) } catch { /* private mode: ignore */ }
  }, [widths])

  const setLeft = useCallback((w: number) => setWidths(v => ({ ...v, left: w })), [])
  const setRight = useCallback((w: number) => setWidths(v => ({ ...v, right: w })), [])
  const reset = useCallback(() => setWidths(DEFAULT_WIDTHS), [])

  return { left: widths.left, right: widths.right, setLeft, setRight, reset }
}
