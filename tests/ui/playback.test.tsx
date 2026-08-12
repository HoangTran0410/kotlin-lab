import { useCallback, useState } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlayback, type Speed } from '../../src/ui/timeline/usePlayback'

/**
 * `usePlayback` gọi `setStep` bên trong vòng lặp rAF của chính nó rồi mong
 * đợi `stepIndex` (prop) phản ánh lại thay đổi đó ở lần render kế — đúng như
 * App thật sẽ làm qua store Zustand (setStep -> re-render -> stepIndex mới).
 * Một `vi.fn()` giả không tự gây re-render, nên bọc trong một hook có state
 * THẬT để lần gọi setStep bên trong hook thực sự vòng lại thành prop mới —
 * nếu không, "user kéo trong lúc đang play" (test 5) không thể phân biệt
 * được với "chính play tự tiến step" (cả hai đều chỉ là một lệnh gọi mock).
 */
function useControlled(initial: number, max: number) {
  const [stepIndex, setStepIndex] = useState(initial)
  const setStep = useCallback((n: number) => setStepIndex(Math.max(0, Math.min(max, n))), [max])
  const playback = usePlayback(stepIndex, setStep, max)
  return { stepIndex, setStep, ...playback }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/**
 * Fake rAF (vitest/@sinonjs/fake-timers) tick theo khung ~16ms cố định — đo
 * bằng test thăm dò trước khi viết file này. `vi.advanceTimersByTime(N)` chỉ
 * chạy các khung ĐÃ ĐẾN HẠN trong đúng N ms, nên khung cuối trước mốc N luôn
 * lệch xuống dưới một chút (N không chia hết 16). Cộng thêm một khung dư để
 * chắc chắn ngưỡng interval bị vượt qua, giống cách một UI thật không cam kết
 * chính xác tới mili-giây với rAF (vsync thật cũng dao động ~16.67ms).
 */
const FRAME_MARGIN_MS = 40
const untilSteps = (n: number, intervalMs: number): number => n * intervalMs + FRAME_MARGIN_MS

describe('usePlayback (Task 17) — play/pause/bước/tốc độ bằng requestAnimationFrame', () => {
  it('play tiến step theo thời gian', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })
    expect(result.current.playing).toBe(true)

    // tốc độ mặc định 1×: 1 step mỗi 1000ms.
    act(() => { vi.advanceTimersByTime(untilSteps(1, 1000)) })
    expect(result.current.stepIndex).toBe(1)

    act(() => { vi.advanceTimersByTime(untilSteps(2, 1000)) })
    expect(result.current.stepIndex).toBe(3)
  })

  it('pause đứng — không tiến thêm nữa', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })
    act(() => { vi.advanceTimersByTime(untilSteps(1, 1000)) })
    expect(result.current.stepIndex).toBe(1)

    act(() => { result.current.pause() })
    expect(result.current.playing).toBe(false)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.stepIndex).toBe(1) // đứng im
  })

  it('tới cuối trace tự dừng, bật lại nút play', () => {
    const { result } = renderHook(() => useControlled(18, 20))
    act(() => { result.current.play() })

    act(() => { vi.advanceTimersByTime(untilSteps(2, 1000)) }) // đủ 2 step: 18 -> 19 -> 20 (max)
    expect(result.current.stepIndex).toBe(20)
    expect(result.current.playing).toBe(false) // tự dừng

    // Không tiến quá max dù thời gian trôi thêm.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.stepIndex).toBe(20)
  })

  it('đổi tốc độ đổi nhịp tiến step', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })

    act(() => { result.current.setSpeed(4 as Speed) }) // 4 step/giây = 250ms/step
    act(() => { vi.advanceTimersByTime(untilSteps(4, 250)) })
    expect(result.current.stepIndex).toBe(4)
  })

  it('user kéo thanh trong lúc đang play thì play dừng', () => {
    const { result } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })
    act(() => { vi.advanceTimersByTime(500) }) // chưa đủ 1000ms, chưa tự tiến step nào

    // User tự kéo Timeline — gọi ĐÚNG cùng setStep mà App thật sẽ gọi.
    act(() => { result.current.setStep(15) })
    expect(result.current.stepIndex).toBe(15)
    expect(result.current.playing).toBe(false)

    // Không tự tiến tiếp sau khi đã dừng vì user kéo.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.stepIndex).toBe(15)
  })

  it('unmount huỷ requestAnimationFrame đang chờ', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const { result, unmount } = renderHook(() => useControlled(0, 20))
    act(() => { result.current.play() })

    unmount()
    expect(cancelSpy).toHaveBeenCalled()

    // Sau unmount, advance timer không được ném — không còn gì lắng nghe rAF.
    expect(() => { act(() => { vi.advanceTimersByTime(5000) }) }).not.toThrow()
  })
})
