import { useCallback, useEffect, useState } from 'react'

/** The three regions around the graph. The graph itself is never hideable. */
export type Region = 'left' | 'bottom' | 'right'

export const REGIONS: readonly Region[] = ['left', 'bottom', 'right']

/** Label on the toggle, and what that region actually holds. */
export const REGION_LABEL: Record<Region, string> = {
  left: 'Code',
  bottom: 'Timeline',
  right: 'Console',
}

export const REGION_TITLE: Record<Region, string> = {
  left: 'The Kotlin editor and its errors',
  bottom: 'The event-by-event timeline scrubber',
  right: 'Console output and the full narration log',
}

export type Visibility = Record<Region, boolean>

/**
 * Same defaults the single debug toggle used to produce — editor open, the
 * other two closed — so nothing moves for someone who liked the old layout.
 */
const DEFAULTS: Visibility = { left: true, bottom: false, right: false }

/**
 * A key of its OWN, separate from `kcl.panels.v1` which holds the widths.
 * Two keys means no migration: an existing user keeps their dragged widths and
 * simply picks up the defaults for visibility.
 */
const STORAGE_KEY = 'kcl.panels.show.v1'

function read(): Visibility {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<Record<Region, unknown>>
    const flag = (x: unknown, fallback: boolean): boolean => typeof x === 'boolean' ? x : fallback
    return {
      left: flag(v.left, DEFAULTS.left),
      bottom: flag(v.bottom, DEFAULTS.bottom),
      right: flag(v.right, DEFAULTS.right),
    }
  } catch {
    return DEFAULTS
  }
}

/**
 * Which regions around the graph are shown, one INDEPENDENT flag each.
 *
 * There used to be a single "Deep debug" button that opened the right column
 * and the bottom timeline together. Those two answer completely different
 * questions — the timeline is for FOLLOWING along, the console is for DIGGING
 * IN — so wanting one without the other is the normal case, not an edge case,
 * and one button couldn't express it.
 */
export function usePanelVisibility() {
  const [show, setShow] = useState<Visibility>(read)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(show)) } catch { /* private mode */ }
  }, [show])

  const toggle = useCallback((r: Region) => setShow(v => ({ ...v, [r]: !v[r] })), [])

  return { show, toggle }
}
