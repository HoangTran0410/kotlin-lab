import { runSourceSafe } from '../engine/run'
import { buildGraphSpec, type GraphSpec } from '../engine/trace/graph'
import type { Event } from '../engine/trace/events'
import type { Diagnostic } from '../engine/validator/diagnostics'

export interface Compiled {
  events: readonly Event[]
  diagnostics: readonly Diagnostic[]
  spec: GraphSpec
  /** Tăng mỗi lần compile. Khoá cache layout ở Task 15. */
  revision: number
}

let revision = 0

export const EMPTY_COMPILED: Compiled = {
  events: [], diagnostics: [], spec: { nodes: [], edges: [] }, revision: 0,
}

export function compile(src: string): Compiled {
  const r = runSourceSafe(src)
  return { events: r.events, diagnostics: r.diagnostics, spec: buildGraphSpec(r.events), revision: ++revision }
}
