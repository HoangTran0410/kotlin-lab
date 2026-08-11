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

/** Exception của Kotlin, ném xuyên qua generator bằng cơ chế throw của JS. */
export class KotlinThrow extends Error {
  constructor(readonly kotlinType: string, readonly kotlinMessage: string) {
    super(`${kotlinType}: ${kotlinMessage}`)
  }
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
