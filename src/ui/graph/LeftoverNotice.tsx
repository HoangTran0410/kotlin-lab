import { useMemo } from 'react'
import type { Event } from '../../engine/trace/events'
import { unfinishedCoroutines, missingRunBlocking } from '../../engine/trace/leftover'

/**
 * "The program ended while N coroutines were still stopped partway through."
 *
 * A real case we've hit: `fun main() { CoroutineScope(...).launch { delay(500); ... } }`
 * — no `runBlocking` anywhere. The program finishes in 0ms, empty output, the
 * graph full of nodes standing still, and NOT A WORD about why. Real Kotlin
 * also produces empty output for this, so it's not an engine bug — but
 * silence is still the worst possible answer to "why didn't it run?".
 *
 * Shown at the top of the graph stage, right where the eye is already looking
 * when it sees nothing happening — not hidden behind the debug button.
 */
export function LeftoverNotice({ events, source }: { events: readonly Event[]; source: string }) {
  const { labels } = useMemo(() => unfinishedCoroutines(events), [events])
  if (events.length === 0 || labels.length === 0) return null

  const missing = missingRunBlocking(source)
  return (
    <div className="k-stage__leftover" role="note" data-testid="leftover-notice">
      <strong>{labels.length} coroutine(s) left unfinished.</strong>{' '}
      The program ends when the ROOT coroutine ends — just like the JVM exits
      right after <code>main</code> returns and kills every daemon thread.
      These haven't finished running:{' '}
      {labels.map((n, i) => (
        <span key={`${n}-${i}`}>{i > 0 ? ', ' : ''}<code>{n}</code></span>
      ))}.
      {missing && (
        <>
          {' '}
          <strong>There's no <code>runBlocking</code> anywhere in the file.</strong>{' '}
          <code>fun main() {'{ ... }'}</code> returns immediately, so nothing
          waits for them. Change it to{' '}
          <code>fun main() = runBlocking {'{ ... }'}</code> then{' '}
          <code>join()</code> (or <code>delay</code>) long enough to see them run.
        </>
      )}
    </div>
  )
}
