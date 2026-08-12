import { useCallback, useEffect, useRef, useState } from 'react'

/** step mỗi giây. */
export type Speed = 0.5 | 1 | 2 | 4

export interface PlaybackApi {
  playing: boolean
  speed: Speed
  play: () => void
  pause: () => void
  setSpeed: (s: Speed) => void
}

/**
 * Phát tiến `stepIndex` tự động bằng `requestAnimationFrame` — không
 * `setInterval`: chạy đúng theo khung hình và TỰ DỪNG khi tab ẩn (trình
 * duyệt ngưng cấp rAF cho tab nền). Ràng buộc cấm `setTimeout` chỉ áp cho
 * `src/engine/**`; UI được phép dùng timer thật, nhưng rAF vẫn tốt hơn cho
 * đúng việc này.
 *
 * `stepIndex`/`setStep`/`max` được đọc qua ref bên trong vòng lặp rAF, KHÔNG
 * liệt kê vào deps của effect chạy vòng lặp: nếu liệt kê, effect huỷ + lập
 * lại `requestAnimationFrame` mỗi khi `stepIndex` đổi — tức là MỖI STEP —
 * phá nhịp thời gian tích luỹ giữa `lastTickRef` và `now`.
 *
 * Tới cuối trace (`stepIndex === max`) thì tự dừng — không có thêm step nào
 * để phát, và giữ vậy thì nút play vẫn hiện "Phát" (không đứng ở trạng thái
 * "đang phát" treo mãi).
 */
/**
 * `advance` quyết định bước KẾ TIẾP từ bước hiện tại. Mặc định `cur + 1`
 * (từng event một, dùng cho thanh timeline gỡ lỗi).
 *
 * Sân khấu đồ thị truyền hàm khác: nhảy tới mốc có DIỄN GIẢI kế tiếp. Hơn nửa
 * số event trong một trace là hạ tầng (`THREAD_STATE`, `JOB_STATE`) — phát
 * từng event một thì phần lớn thời gian màn hình đứng yên, và người xem tưởng
 * công cụ treo. Vòng lặp thời gian vẫn chỉ có MỘT bản, ở đây.
 */
export function usePlayback(
  stepIndex: number,
  setStep: (n: number) => void,
  max: number,
  advance?: (cur: number) => number,
): PlaybackApi {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState<Speed>(1)
  const advanceRef = useRef(advance)
  useEffect(() => { advanceRef.current = advance }, [advance])

  const stepIndexRef = useRef(stepIndex)
  const setStepRef = useRef(setStep)
  const maxRef = useRef(max)
  const speedRef = useRef(speed)
  const lastTickRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  // true đúng một lần đổi `stepIndex` kế tiếp: đánh dấu lần đổi đó là do
  // CHÍNH vòng lặp play gây ra, để effect theo dõi bên dưới phân biệt được
  // với user tự kéo thanh Timeline trong lúc đang play.
  const ownUpdateRef = useRef(false)

  useEffect(() => { stepIndexRef.current = stepIndex }, [stepIndex])
  useEffect(() => { setStepRef.current = setStep }, [setStep])
  useEffect(() => { maxRef.current = max }, [max])
  useEffect(() => { speedRef.current = speed }, [speed])

  // User kéo thanh Timeline trong lúc đang play -> phải dừng play, nếu không
  // thanh sẽ giằng co với ngón tay (play tiếp tục ghi đè vị trí user vừa kéo
  // tới ở khung hình kế tiếp).
  useEffect(() => {
    if (ownUpdateRef.current) { ownUpdateRef.current = false; return }
    setPlaying(prev => (prev ? false : prev))
  }, [stepIndex])

  useEffect(() => {
    if (!playing) { lastTickRef.current = null; return }

    let cancelled = false
    // Đọc thời gian bằng Date.now(), KHÔNG dùng tham số `now` mà rAF truyền
    // vào callback: đã đo bằng test thăm dò — dưới fake timer (vitest,
    // @sinonjs/fake-timers) tham số đó vẫn là performance.now() THẬT (đồng hồ
    // hệ thống thật), không đồng bộ với đồng hồ ảo mà vi.advanceTimersByTime
    // điều khiển, nên hiệu số `now - lastTick` gần như luôn bằng 0 và
    // playback không bao giờ tiến được trong test. Date.now() thì fake timer
    // CÓ giả lập (mặc định trong toFake) và tăng đúng nhịp khi advance.
    const tick = (): void => {
      if (cancelled) return
      const now = Date.now()
      if (lastTickRef.current === null) lastTickRef.current = now

      const intervalMs = 1000 / speedRef.current
      if (now - lastTickRef.current >= intervalMs) {
        lastTickRef.current = now
        const thô = advanceRef.current
          ? advanceRef.current(stepIndexRef.current)
          : stepIndexRef.current + 1
        // Luôn tiến ít nhất một bước: một `advance` trả về giá trị không lớn
        // hơn hiện tại sẽ làm vòng phát đứng im mà nút vẫn hiện "đang phát".
        const next = Math.min(maxRef.current, Math.max(stepIndexRef.current + 1, thô))
        if (next !== stepIndexRef.current) {
          ownUpdateRef.current = true
          stepIndexRef.current = next
          setStepRef.current(next)
        }
        if (next >= maxRef.current) {
          setPlaying(false)
          return // tới cuối: tự dừng, không xin thêm khung hình
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing])

  const play = useCallback(() => {
    if (stepIndexRef.current >= maxRef.current) return // đã ở cuối, không có gì để phát
    setPlaying(true)
  }, [])
  const pause = useCallback(() => setPlaying(false), [])
  const setSpeed = useCallback((s: Speed) => setSpeedState(s), [])

  return { playing, speed, play, pause, setSpeed }
}
