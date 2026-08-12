import { DISPATCHER_POOL_SIZE } from '../../engine/runtime/dispatcher'
import { jobLabel } from '../../engine/trace/label'
import type { WorldState } from '../../engine/trace/world'
import './thread-pools.css'

/**
 * What each dispatcher's threads are doing at the step being viewed.
 *
 * Why this exists: the engine models dispatchers carefully — fixed-size pools,
 * acquire/release, a DISPATCH event on every hop — and NONE of it reached the
 * screen. `threadId` was rendered nowhere in the UI at all. So the two things
 * the dispatcher lesson exists to teach were both invisible:
 *
 *   1. `Dispatchers.IO` vs `Dispatchers.Default` differ in POOL SIZE, and that
 *      size is the whole point (IO threads mostly sit waiting on I/O, so there
 *      are more of them). A number in prose doesn't land; eight slots next to
 *      four does.
 *   2. `withContext(Dispatchers.IO)` moves the SAME coroutine to a different
 *      pool and back. On the graph that showed up as... nothing. Here you watch
 *      the coroutine leave a Main slot, occupy an IO slot, and come back.
 *
 * The "waiting" count per pool carries the lesson that makes coroutines worth
 * having: a suspended coroutine holds NO thread. Twenty coroutines can be in
 * flight on a pool of four, because the nineteen sitting in `delay` gave their
 * threads back.
 *
 * Everything here is derived from `world` — no state of its own — so scrubbing
 * the timeline replays the thread hops exactly, in both directions.
 */

/** Fixed order so the strip doesn't reshuffle as new dispatchers appear. */
const POOL_ORDER = ['Main', 'Default', 'IO', 'Unconfined']

/** One line on why this pool is the size it is. Shown next to the slot count. */
const POOL_NOTE: Record<string, string> = {
  Main: 'the UI thread — one, and never more',
  Default: 'CPU work — sized to the cores',
  IO: 'blocking I/O — a wider pool, because these threads mostly sit waiting',
  Unconfined: 'no pool — deterministic carrier approximates whichever thread resumes it',
}

export function ThreadPools({ world }: { world: WorldState }) {
  const jobs = [...world.jobs.values()]
  if (jobs.length === 0) return null

  // Only pools actually in play. Always drawing all four would put ten idle
  // slots on screen for a program that never leaves Main.
  const inPlay = new Set(jobs.map(j => j.dispatcher))
  const pools = [
    ...POOL_ORDER.filter(d => inPlay.has(d)),
    ...[...inPlay].filter(d => !POOL_ORDER.includes(d)).sort(),
  ]

  /**
   * Is this job still alive? Needed because two JobView fields are STICKY and
   * both were measured lying here:
   *   - `threadId` is cleared on COROUTINE_SUSPENDED but NOT when a job ends,
   *     so a finished coroutine keeps naming the last thread it ran on. Reading
   *     it directly put dead coroutines in occupied slots (measured: a job
   *     `Completed` at t=20 still reported `IO-1`).
   *   - `suspendReason` is likewise never cleared, so a coroutine cancelled
   *     while parked in `delay` still looks "suspended".
   */
  const alive = (state: string): boolean => state === 'Active' || state === 'New'

  // The hop happening at THIS step, so the arrival is visible at the moment it
  // happens rather than only as a changed layout.
  const justMovedTo = world.lastEvent?.k === 'DISPATCH' ? world.lastEvent.threadId : null

  return (
    <div className="pools" aria-label="Dispatcher thread pools">
      {pools.map(d => {
        const size = DISPATCHER_POOL_SIZE[d] ?? 1
        const slots = d === 'Unconfined'
          ? ['Unconfined-carrier']
          : Array.from({ length: size }, (_, i) => `${d}-${i + 1}`)
        // Holds no thread but is alive: suspended at delay/join/await. This is
        // the number that explains why a small pool is enough.
        const waiting = jobs.filter(
          j => j.dispatcher === d && j.threadId === null
            && j.suspendReason !== null && j.state === 'Active').length

        return (
          <div className="pools__row" key={d} data-dispatcher={d}>
            <div className="pools__head">
              <span className={`pools__name pools__name--${d}`}>{d}</span>
              <span className="pools__size">
                {d === 'Unconfined' ? 'no dedicated pool' : `${size} ${size === 1 ? 'thread' : 'threads'}`}
              </span>
              <span className="pools__note">{POOL_NOTE[d] ?? ''}</span>
            </div>
            <ul className="pools__slots">
              {slots.map(slot => {
                // Occupancy comes from the JOBS, not from `world.threads`.
                //
                // `world.threads` looks like the authority — it's fed by
                // THREAD_STATE on the real acquire/release — but it LAGS:
                // measured order on a withContext hop is DISPATCH (idx 8),
                // COROUTINE_STARTED (9), THREAD_STATE RUNNING (10). Reading it
                // would leave the slot empty at exactly the step that announces
                // the hop, which is the one step the learner is looking at.
                //
                // A live job naming this thread is both accurate and in step:
                // COROUTINE_SUSPENDED clears `threadId` the moment the thread
                // goes back, and `alive` drops the finished jobs whose stale
                // `threadId` would otherwise squat on a slot forever.
                const holder = jobs.find(j => j.threadId === slot && alive(j.state))
                return (
                  <li
                    key={slot}
                    className={[
                      'pools__slot',
                      holder ? 'pools__slot--busy' : 'pools__slot--free',
                      slot === justMovedTo ? 'pools__slot--arrived' : '',
                    ].filter(Boolean).join(' ')}
                    title={holder ? `${slot}: ${jobLabel(holder)}` : `${slot}: idle`}
                    data-testid={`slot-${slot}`}
                  >
                    <span className="pools__slotId">{slot}</span>
                    {/* An idle slot says "idle", not nothing: an empty box reads
                        as "no data" rather than "this thread is free". */}
                    <span className="pools__holder">{holder ? jobLabel(holder) : 'idle'}</span>
                  </li>
                )
              })}
              {waiting > 0 && (
                <li className="pools__waiting" data-testid={`waiting-${d}`}>
                  +{waiting} suspended, holding no thread
                </li>
              )}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
