import { useCallback, useRef } from 'react'

/**
 * Thanh kéo giữa hai cột.
 *
 * Dùng Pointer Events chứ không phải mouse: một API chạy cho cả chuột lẫn cảm
 * ứng lẫn bút. `setPointerCapture` khiến mọi chuyển động tiếp theo vẫn về đúng
 * thanh này kể cả khi con trỏ chạy ra ngoài nó — không có nó thì kéo nhanh một
 * chút là con trỏ lọt sang canvas đồ thị và thanh "rơi" giữa chừng.
 *
 * Bàn phím cũng kéo được (mũi tên trái/phải): kéo-thả bằng chuột là tương tác
 * duy nhất trong app này mà người dùng bàn phím sẽ mất hẳn nếu không làm.
 */
export function Splitter({ label, width, setWidth, min, max, invert = false }: {
  label: string
  width: number
  setWidth: (w: number) => void
  min: number
  max: number
  /** true khi cột nằm BÊN PHẢI thanh (kéo sang trái = rộng ra). */
  invert?: boolean
}) {
  const start = useRef<{ x: number; w: number } | null>(null)

  // Kẹp vào biên VÀ chặn giá trị không phải số hữu hạn. `clientX` có thể không
  // tới được handler (jsdom không cài PointerEvent; ngoài đời là event tổng hợp
  // hoặc thiết bị lạ), và khi đó `w` thành NaN — `Math.max/min` truyền NaN qua
  // nguyên vẹn, nên không chặn ở đây thì `--w-left: NaNpx` làm sập cả lưới.
  const kep = useCallback(
    (w: number) => (Number.isFinite(w) ? Math.max(min, Math.min(max, w)) : width),
    [min, max, width],
  )

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Không phải mọi môi trường đều có Pointer Capture API.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (!Number.isFinite(e.clientX)) return
    start.current = { x: e.clientX, w: width }
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current || !Number.isFinite(e.clientX)) return
    const delta = e.clientX - start.current.x
    setWidth(kep(start.current.w + (invert ? -delta : delta)))
  }, [invert, kep, setWidth])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    start.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const buoc = e.shiftKey ? 48 : 12
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(kep(width + (invert ? buoc : -buoc))) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(kep(width + (invert ? -buoc : buoc))) }
  }, [invert, kep, setWidth, width])

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
