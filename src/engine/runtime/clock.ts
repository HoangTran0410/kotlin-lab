interface Timer { id: number; at: number; seq: number; fn: () => void }

export class VirtualClock {
  private t = 0
  private nextId = 1
  private seq = 0
  private timers: Timer[] = []

  get now(): number { return this.t }
  get hasPendingTimers(): boolean { return this.timers.length > 0 }

  schedule(atMs: number, fn: () => void): number {
    const id = this.nextId++
    this.timers.push({ id, at: Math.max(atMs, this.t), seq: this.seq++, fn })
    return id
  }

  cancel(id: number): void {
    const i = this.timers.findIndex(x => x.id === id)
    if (i >= 0) this.timers.splice(i, 1)
  }

  /**
   * Nhảy tới mốc thời gian gần nhất và chạy MỌI timer đúng mốc đó,
   * theo thứ tự đăng ký. Trả false nếu không còn timer nào.
   */
  advanceToNextTimer(): boolean {
    if (this.timers.length === 0) return false
    this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
    const at = this.timers[0]!.at
    this.t = Math.max(this.t, at)
    const due: Timer[] = []
    while (this.timers.length > 0 && this.timers[0]!.at === at) due.push(this.timers.shift()!)
    for (const timer of due) timer.fn()
    return true
  }
}
