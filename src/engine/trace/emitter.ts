import type { Event, EventBody } from './events'

export class TraceEmitter {
  private seq = 0
  private t = 0
  readonly events: Event[] = []

  setClock(t: number): void { this.t = t }
  get clock(): number { return this.t }

  /**
   * Note for CALLERS: body is spread SHALLOWLY, so nested objects inside it
   * (e.g. the `ctx` of COROUTINE_CREATED) are kept BY REFERENCE. Always build
   * a fresh object for every emit; reusing one and mutating it later would
   * change history events along with it, breaking the invariant that 'the
   * trace is the one source of truth'.
   */
  emit(body: EventBody, srcLine?: number): void {
    const e = { ...body, seq: this.seq++, t: this.t } as Event
    if (srcLine !== undefined) e.srcLine = srcLine
    this.events.push(e)
  }
}
