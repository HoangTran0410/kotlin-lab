import type { Event, JobId } from '../trace/events'
import { jobLabel } from '../trace/label'
import type { WorldState } from '../trace/world'

/**
 * Turns ONE event into ONE English sentence. Pure function.
 *
 * `before` is the world RIGHT BEFORE `event` is applied — needed so the
 * sentence can talk about the state it's about to leave ("waiting", "still
 * alive"), and to look up the names of jobs that already exist.
 *
 * Returning `null` means this event isn't worth a sentence (pure
 * infrastructure like THREAD_STATE). Returning an empty string is NEVER
 * valid — the reader would see a blank line with no way to tell whether
 * that's a bug or intentional.
 *
 * Because everything is derived from structured data, code the learner
 * writes themselves also gets a narration — nobody has to hand-write each
 * step the way the old HTML version did.
 *
 * Convention: every identifier (job name, thread, exception type) is wrapped
 * in backticks. The display layer splits on backticks to render them in a
 * monospace font — see NarrationPanel.
 */
export function narrate(event: Event, before: WorldState): string | null {
  const e = event
  /** Name of a job already in the world; a job never seen before returns its own id. */
  const at = (id: JobId): string => {
    const j = before.jobs.get(id)
    return j ? jobLabel(j) : id
  }

  switch (e.k) {
    case 'COROUTINE_CREATED': {
      const self = jobLabel({ id: e.id, builder: e.builder, name: e.ctx.name, varName: e.varName })
      const dispatcherNote = e.ctx.dispatcher ? ` (dispatcher \`${e.ctx.dispatcher}\`)` : ''
      if (e.parentId === null) {
        return e.builder === 'scope'
          ? `\`${self}\` was created — a ROOT scope, with no parent. It doesn't sit under any coroutine, so nobody waits for it and nobody cancels it for you.`
          : `\`${self}\` was created — the root of the job tree${dispatcherNote}.`
      }
      const sup = e.ctx.isSupervisor
        ? ' This is a supervisor boundary: failure from a DIRECT child stops here.'
        : ''
      return `\`${self}\` was created under \`${at(e.parentId)}\`${dispatcherNote}.${sup}`
    }

    case 'COROUTINE_STARTED':
      return `\`${at(e.id)}\` started running on thread \`${e.threadId}\`.`

    case 'COROUTINE_RESUMED':
      return `\`${at(e.id)}\` resumed on thread \`${e.threadId}\` — picking up exactly where it left off, not starting over.`

    case 'COROUTINE_SUSPENDED': {
      const self = at(e.id)
      const thread = before.jobs.get(e.id)?.threadId
      const returned = thread ? ` Thread \`${thread}\` is RETURNED to the pool` : ' Thread is RETURNED to the pool'
      switch (e.reason) {
        case 'delay':
          return `\`${self}\` hits \`delay\` and pauses.${returned} — not blocked, another coroutine can use it right away.`
        case 'join':
          // Deliberately does NOT say "waiting for another coroutine": at the
          // Event layer, `join()` called by the learner and `joinChildren`
          // that a scope emits on its own when its body ends both carry
          // reason 'join' — they're indistinguishable. `runBlocking` at the
          // end of the program is waiting for ITS OWN CHILDREN, so the
          // sentence "waiting for another coroutine" would be a small lie
          // told exactly where the learner is most likely to misread it.
          return `\`${self}\` pauses to wait (\`join\`).${returned} while it waits.`
        case 'await':
          return `\`${self}\` waits for the result of a \`Deferred\` (\`await\`).${returned} while it waits.`
        case 'yield':
          return `\`${self}\` yields its turn to another coroutine (\`yield\`).`
        default:
          return `\`${self}\` pauses (\`${e.reason}\`).${returned} while it waits.`
      }
    }

    case 'JOB_STATE': {
      const self = at(e.id)
      if (e.to === 'Completed') return `\`${self}\` completed normally.`
      if (e.to === 'Cancelling') {
        return e.cause
          ? `\`${self}\` starts cancelling, cause \`${e.cause}\`.`
          : `\`${self}\` starts cancelling.`
      }
      if (e.to === 'Cancelled') return `\`${self}\` finished cancelling.`
      // New→Active and Active→Completing are internal transitions that carry
      // no information the learner needs — letting them generate sentences
      // would drown out the ones worth reading.
      return null
    }

    case 'EXCEPTION_THROWN':
      return `\`${at(e.id)}\` throws \`${e.exType}\`${e.message ? `: "${e.message}"` : ''}.`

    case 'EXCEPTION_CAUGHT':
      // CancellationException must NOT be phrased the same as an ordinary
      // error. The sentence "it was handled so the job doesn't fail" is
      // technically true but teaches the wrong lesson exactly where people
      // get it wrong most often: the job is still cancelled — only the
      // cancel signal got swallowed.
      return e.exType === 'CancellationException'
        ? `\`${at(e.id)}\` caught \`CancellationException\` — this is a CANCEL SIGNAL, not an error. Catching it swallows the cancellation: the coroutine body keeps running as if nothing happened, while the Job is already Cancelled.`
        : `\`${at(e.id)}\` CAUGHT \`${e.exType}\` — the exception was handled, so this job does NOT fail.`

    case 'FAILURE_PROPAGATED': {
      const child = at(e.from)
      const parent = at(e.to)
      return e.blockedBySupervisor
        ? `\`${child}\` finished abnormally, but \`${parent}\` is a supervisor — the failure STOPS here. \`${child}\`'s siblings are unaffected.`
        : `\`${child}\` finished abnormally. \`${parent}\` is a regular Job (not a supervisor), so the failure propagates UP to \`${parent}\` — taking every one of its remaining children down with it.`
    }

    case 'CANCEL_REQUESTED':
      return e.from === 'user'
        ? `Code calls \`cancel()\` on \`${at(e.to)}\` (cause \`${e.cause}\`).`
        : `\`${at(e.from)}\` cancels \`${at(e.to)}\` — cancellation always flows DOWN, to the whole subtree.`

    case 'HANDLER_RECEIVED':
      return `Handler \`${e.handler}\` receives \`${e.exType}\` — this is the last stop, there's nobody further up to propagate to.`

    case 'DISPATCH':
      return `\`${at(e.id)}\` switches to dispatcher \`${e.dispatcher}\`, thread \`${e.threadId}\` — still the same coroutine, only the thread changes.`

    case 'PRINTLN':
      return `\`${at(e.id)}\` prints: "${e.text}"`

    // Pure infrastructure: already shown on the graph/timeline, turning it into a sentence would only add noise.
    case 'THREAD_STATE':
      return null

    default:
      return null
  }
}
