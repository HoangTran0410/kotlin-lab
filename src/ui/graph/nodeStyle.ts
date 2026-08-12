import type { JobState } from '../../engine/trace/events'
import type { GraphNodeSpec } from '../../engine/trace/graph'
import type { WorldState } from '../../engine/trace/world'

/**
 * The lifecycle phase of a node AT THE STEP BEING VIEWED — not the Kotlin
 * state (`JobState`), but "how toReactFlow should draw it":
 *   - 'unborn'   its COROUTINE_CREATED hasn't happened at this step
 *                (world.jobs doesn't have this id yet). Drawn as a faded
 *                ghost (Decision 2, option b).
 *   - 'terminal' already Completed/Cancelled — won't change any further in
 *                the rest of the trace (though the trace may still emit
 *                further events RELATED to this job, e.g. a late
 *                FAILURE_PROPAGATED pointing at it — backlog item A4 — but
 *                the job's own state doesn't change anymore).
 *   - 'live'     everything else: New/Active/Completing/Cancelling.
 */
export type Phase = 'unborn' | 'live' | 'terminal'

const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['Completed', 'Cancelled'])

/** Reads EACH node from `world.jobs` — never inferred from the parent (backlog item A1, see toReactFlow.ts). */
export function phase(node: GraphNodeSpec, world: WorldState): Phase {
  const job = world.jobs.get(node.id)
  if (!job) return 'unborn'
  return TERMINAL_STATES.has(job.state) ? 'terminal' : 'live'
}

/**
 * Accent by builder — CSS tokens already declared in `theme/tokens.css`.
 * Returns the `var(--k-*)` string DIRECTLY, not a color code, so changing the
 * theme only requires editing tokens.css, not TypeScript.
 */
const BUILDER_ACCENT: Readonly<Record<string, string>> = {
  runBlocking: 'var(--k-runBlocking)',
  launch: 'var(--k-launch)',
  async: 'var(--k-async)',
  coroutineScope: 'var(--k-coroutineScope)',
  supervisorScope: 'var(--k-supervisorScope)',
  withContext: 'var(--k-withContext)',
  // The root job of CoroutineScope(ctx). Deliberately NEUTRAL (blue-gray),
  // unlike the six builder colors above: it isn't a builder the learner
  // typed, just the structural anchor that `CoroutineScope(...)` sets up
  // implicitly.
  scope: 'var(--k-scope)',
}

/** An unknown builder (no token yet, e.g. M3 adding a new builder) -> falls back to `--fg-dim`, never throws. */
export function builderAccent(builder: string): string {
  return BUILDER_ACCENT[builder] ?? 'var(--fg-dim)'
}

/**
 * Border by JobState. Only three state color tokens exist in tokens.css
 * (`--state-active`, `--state-completed`, `--state-cancelled`); `New` has
 * nothing to color yet so it uses `--fg-dim`. `Completing` is grouped with
 * `Active` (still running the rest of its body — Completing isn't an error
 * state). `Cancelling` is grouped with `Cancelled` (already on its way to
 * being cancelled, the visual should warn ahead of time).
 */
const STATE_BORDER: Readonly<Record<JobState, string>> = {
  New: 'var(--fg-dim)',
  Active: 'var(--state-active)',
  Completing: 'var(--state-active)',
  Completed: 'var(--state-completed)',
  Cancelling: 'var(--state-cancelled)',
  Cancelled: 'var(--state-cancelled)',
}

export function stateBorder(state: JobState): string {
  return STATE_BORDER[state]
}
