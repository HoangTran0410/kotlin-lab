import { useCallback, useRef } from 'react'

/**
 * The drag handle between two columns.
 *
 * Uses Pointer Events instead of mouse: one API that works for mouse, touch,
 * and pen alike. `setPointerCapture` makes every subsequent movement keep
 * reporting to this handle even when the pointer runs outside it — without
 * it, dragging a bit fast and the pointer slips onto the graph canvas and the
 * handle "drops" mid-drag.
 *
 * The keyboard can drag it too (left/right arrows): mouse drag-and-drop is
 * the one interaction in this app that keyboard users would lose entirely if
 * this weren't done.
 */
export function Splitter({ label, width, setWidth, min, max, invert = false }: {
  label: string
  width: number
  setWidth: (w: number) => void
  min: number
  max: number
  /** true when the column sits to the RIGHT of the handle (dragging left = wider). */
  invert?: boolean
}) {
  const start = useRef<{ x: number; w: number } | null>(null)

  // Clamp to the bounds AND block anything that isn't a finite number.
  // `clientX` may never reach the handler (jsdom doesn't install PointerEvent;
  // in the real world it can be a synthetic event or an unusual device), and
  // when that happens `w` becomes NaN — `Math.max/min` pass NaN straight
  // through, so without this guard `--w-left: NaNpx` collapses the whole grid.
  const clamp = useCallback(
    (w: number) => (Number.isFinite(w) ? Math.max(min, Math.min(max, w)) : width),
    [min, max, width],
  )

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Not every environment has the Pointer Capture API.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (!Number.isFinite(e.clientX)) return
    start.current = { x: e.clientX, w: width }
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current || !Number.isFinite(e.clientX)) return
    const delta = e.clientX - start.current.x
    setWidth(clamp(start.current.w + (invert ? -delta : delta)))
  }, [invert, clamp, setWidth])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    start.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 12
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(clamp(width + (invert ? step : -step))) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(clamp(width + (invert ? -step : step))) }
  }, [invert, clamp, setWidth, width])

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid={`splitter-${label}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="splitter__grip" />
    </div>
  )
}
