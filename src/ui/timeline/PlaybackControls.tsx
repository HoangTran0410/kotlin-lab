import { usePlayback, type Speed } from './usePlayback'
import './timeline.css'

const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4]

/**
 * Bọc `usePlayback` (Task 17) thành UI: play/tạm dừng, bước lùi/tiến thủ
 * công, và chọn tốc độ. Không tự cài logic thời gian ở đây — mọi trạng thái
 * (playing/speed) và vòng lặp rAF đều sống trong hook, component chỉ đọc và
 * gọi lại.
 *
 * `disabled` khi `max === 0` (trace rỗng, giống Timeline.tsx) — tránh phát ra
 * điều khiển bấm được nhưng không có gì để phát.
 */
export function PlaybackControls({ stepIndex, setStep, max }: {
  stepIndex: number
  setStep: (n: number) => void
  max: number
}) {
  const { playing, speed, play, pause, setSpeed } = usePlayback(stepIndex, setStep, max)
  const disabled = max === 0

  return (
    <div className="playback">
      <button
        type="button"
        onClick={() => setStep(Math.max(0, stepIndex - 1))}
        disabled={disabled || stepIndex <= 0}
        aria-label="Lùi một bước"
      >
        Lùi
      </button>
      <button
        type="button"
        onClick={playing ? pause : play}
        disabled={disabled}
        aria-pressed={playing}
      >
        {playing ? 'Tạm dừng' : 'Phát'}
      </button>
      <button
        type="button"
        onClick={() => setStep(Math.min(max, stepIndex + 1))}
        disabled={disabled || stepIndex >= max}
        aria-label="Tiến một bước"
      >
        Tiến
      </button>
      <div className="playback__speed" role="group" aria-label="Tốc độ phát">
        {SPEEDS.map(s => (
          <button
            key={s}
            type="button"
            className="playback__speed-btn"
            aria-pressed={speed === s}
            disabled={disabled}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  )
}
