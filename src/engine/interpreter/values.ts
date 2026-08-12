import type { Lambda } from '../ast/nodes'
import type { Env } from './env'

export type KValue =
  | { t: 'unit' }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'str'; v: string }
  | { t: 'null' }
  | { t: 'lambda'; lambda: Lambda; env: Env }
  | { t: 'obj'; className: string; fields: Map<string, KValue> }
  | { t: 'range'; from: number; to: number }

export const UNIT: KValue = { t: 'unit' }

/** A Kotlin exception, thrown across the generator using JS's throw mechanism. */
export class KotlinThrow extends Error {
  /**
   * `line` is the 1-based line of the `throw` statement that caused this
   * exception. Optional because many KotlinThrows are internal (loop ran too
   * long, a synthetic re-throw of CancellationException while unwinding) — not
   * tied to any specific line of user code.
   */
  constructor(readonly kotlinType: string, readonly kotlinMessage: string, readonly line?: number) {
    super(`${kotlinType}: ${kotlinMessage}`)
  }
}

/**
 * The value the scheduler passes back into the generator on resume has type
 * `unknown` — it knows nothing about KValue. The only place that needs to
 * narrow it is `await`, where a Deferred's result flows back into the interpreter.
 */
export function isKValue(v: unknown): v is KValue {
  return typeof v === 'object' && v !== null && 't' in v
}

export function truthy(v: KValue): boolean {
  return v.t === 'bool' ? v.v : v.t !== 'null' && v.t !== 'unit'
}

export function display(v: KValue): string {
  switch (v.t) {
    case 'num': return Number.isInteger(v.v) ? String(v.v) : String(v.v)
    case 'str': return v.v
    case 'bool': return String(v.v)
    case 'null': return 'null'
    case 'unit': return 'kotlin.Unit'
    case 'range': return `${v.from}..${v.to}`
    case 'lambda': return 'Function'
    case 'obj': return v.className
  }
}
