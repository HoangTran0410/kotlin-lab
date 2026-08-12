import { useEffect } from 'react'

export interface Transport {
  play: () => void
  pause: () => void
  playing: boolean
  stepBack: () => void
  stepForward: () => void
  toStart: () => void
  toEnd: () => void
}

/**
 * Is the keystroke meant for something that takes text?
 *
 * This guard is the whole reason the hook is careful: the main thing on screen
 * is a CODE EDITOR, where Space, arrows, Home and End all have their own
 * obvious meanings. Stealing them while someone is typing Kotlin would make
 * the editor feel broken — the transport is worth nothing next to that.
 *
 * Checks CodeMirror's own container too, not just tag names: CodeMirror's
 * editable surface is a contenteditable div, so a tag check alone lets every
 * keystroke through while the user is typing.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('.cm-editor') !== null) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Keyboard transport for the trace: Space plays/pauses, ←/→ step, Home/End
 * jump to the ends.
 *
 * Bound to `window` rather than to a focusable element: watching a trace is
 * something you do while looking at the graph, not at a control, and asking
 * someone to tab to a toolbar first defeats the point.
 *
 * Modified keystrokes are deliberately left alone (Cmd/Ctrl/Alt) so browser
 * and OS shortcuts keep working.
 */
export function useKeyboardTransport(t: Transport, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) return

      switch (e.key) {
        case ' ':
          // preventDefault or the page scrolls on Space, which is the single
          // most jarring thing a play shortcut can do.
          e.preventDefault()
          if (t.playing) t.pause(); else t.play()
          return
        case 'ArrowLeft': e.preventDefault(); t.stepBack(); return
        case 'ArrowRight': e.preventDefault(); t.stepForward(); return
        case 'Home': e.preventDefault(); t.toStart(); return
        case 'End': e.preventDefault(); t.toEnd(); return
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [t, enabled])
}
