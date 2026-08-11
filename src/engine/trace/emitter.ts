import type { Event, EventBody } from './events'

export class TraceEmitter {
  private seq = 0
  private t = 0
  readonly events: Event[] = []

  setClock(t: number): void { this.t = t }
  get clock(): number { return this.t }

  emit(body: EventBody, srcLine?: number): void {
    const e = { ...body, seq: this.seq++, t: this.t } as Event
    if (srcLine !== undefined) e.srcLine = srcLine
    this.events.push(e)
  }
}
