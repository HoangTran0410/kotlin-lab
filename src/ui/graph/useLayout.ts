import { useEffect, useRef, useState } from 'react'
import type { Compiled } from '../../state/compile'
import { layoutGraph, type LayoutResult } from './elkLayout'

const EMPTY_LAYOUT: LayoutResult = new Map()

export interface LayoutState {
  layout: LayoutResult
  error: string | null
}

const EMPTY_LAYOUT_STATE: LayoutState = { layout: EMPTY_LAYOUT, error: null }

/**
 * Runs `layoutGraph` (ELK, Task 11) inside a `useEffect` with dependency
 * **`compiled.revision`** — NOT `compiled.spec` (a NEW object every time
 * `compile()` runs even with identical content, so a reference comparison in
 * the deps array would always see it as changed) and NOT `stepIndex`.
 *
 * This is where Decision 2 (toReactFlow, Task 12) gets ENFORCED at the hook
 * layer: `useLabStore.setStep` never touches the `compiled` field, so the
 * `compiled` reference doesn't change when the user drags the timeline — this
 * effect doesn't rerun, ELK doesn't rerun, the graph doesn't jitter. If
 * someone added `stepIndex` to the deps, ELK would rerun on EVERY drag tick
 * (test 1 below counts the number of calls for exactly this reason).
 *
 * ELK is async, and the source recompiles on a 250ms debounce while typing: a
 * slow layout from compile A can come back AFTER the user has already typed
 * their way to compile B — applying that result unconditionally would show a
 * layout that doesn't match whatever source is currently on screen. An
 * increasing token keeps track of the "current run"; a result that comes back
 * later than the current token (whether because a new compile overwrote it,
 * or because of unmount) is THROWN AWAY, no setState — both paths share one
 * mechanism: the effect's cleanup (which runs when deps change OR on unmount)
 * always makes the token of the run that just finished stale.
 */
export function useLayout(compiled: Compiled): LayoutState {
  const [state, setState] = useState<LayoutState>(EMPTY_LAYOUT_STATE)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current

    // Empty spec (never compiled yet, or empty source): nothing to lay out.
    // Return an empty map directly, don't call layoutGraph — layoutGraph
    // already short-circuits the same way (elkLayout.ts), but going through a
    // Promise still costs a wasted microtask on the most frequently hit path
    // (mount).
    if (compiled.spec.nodes.length === 0) {
      setState(EMPTY_LAYOUT_STATE)
      return
    }

    setState(current => current.error === null ? current : { ...current, error: null })
    layoutGraph(compiled.spec).then(
      result => {
        if (token !== tokenRef.current) return // this run is stale — discard
        setState({ layout: result, error: null })
      },
      error => {
        if (token !== tokenRef.current) return // this run is stale — discard
        setState({
          layout: EMPTY_LAYOUT,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )

    return () => {
      // Runs when deps change (a new compile overwrote it) OR on unmount.
      // Both cases mean the same thing: the run that just happened is no
      // longer "current". Invalidate its token — if the promise above
      // resolves afterward (whether later than a new compile, or after
      // unmount), the token comparison above discards it on its own, no
      // setState.
      tokenRef.current += 1
    }
  }, [compiled.revision])

  return state
}
