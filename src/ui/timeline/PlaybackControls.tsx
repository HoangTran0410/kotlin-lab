import { usePlayback, type Speed } from './usePlayback'
import './timeline.css'

const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4]

/**
 * Wraps `usePlayback` (Task 17) into UI: play/pause, manual step
 * back/forward, and speed selection. No time logic is implemented here — all
 * state (playing/speed) and the rAF loop live in the hook, the component just
 * reads and calls back into it.
 *
 * `disabled` when `max === 0` (empty trace, same as Timeline.tsx) — avoids
 * exposing clickable controls with nothing to play.
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
        aria-label="Step back"
      >
        Back
      </button>
      <button
        type="button"
        onClick={playing ? pause : play}
        disabled={disabled}
        aria-pressed={playing}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        onClick={() => setStep(Math.min(max, stepIndex + 1))}
        disabled={disabled || stepIndex >= max}
        aria-label="Step forward"
      >
        Forward
      </button>
      <div className="playback__speed" role="group" aria-label="Playback speed">
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
