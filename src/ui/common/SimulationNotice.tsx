/**
 * Design §2.4 and §12: learners very easily assume this deterministic order
 * is the ONLY possible order. The notice must be PERMANENT — no prop to turn
 * it off, no close button, no auto-hide. If someone wants to hide it, they
 * have to edit this file and explain why in the commit.
 *
 * It also carries the leftover M1 group-A item: a few events' order diverges
 * from real Kotlin (a scope's catch runs before a cancelled sibling's finally).
 */
export function SimulationNotice() {
  return (
    <div className="sim-notice" role="note">
      <strong>Deterministic simulation.</strong> This tool always produces a single, fixed run
      order for the same piece of code. Real Kotlin runs multi-threaded and can interleave
      differently — especially the order between coroutines that become ready at the same time.
    </div>
  )
}
