/**
 * Single-cell memo, comparing each argument by reference.
 *
 * Not to make foldTrace faster — measured: folding a whole 16k-event trace
 * costs 0.49ms, i.e. 3% of one 60fps frame. The real reason is REFERENCE
 * STABILITY: foldTrace returns a NEW object on every call, so calling it
 * directly inside a selector would make every component re-render on every
 * store change, even when stepIndex hasn't changed.
 */
export function memoizeTwo<A, B, R>(fn: (a: A, b: B) => R): (a: A, b: B) => R {
  let lastA: A | undefined
  let lastB: B | undefined
  let last: R | undefined
  let has = false
  return (a, b) => {
    if (has && lastA === a && lastB === b) return last as R
    lastA = a; lastB = b; last = fn(a, b); has = true
    return last
  }
}
