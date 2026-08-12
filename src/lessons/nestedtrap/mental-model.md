## Mental model

A supervisor only blocks the failure of its **DIRECT child**. Just one level.

Adding one regular `launch` in the middle means you've rebuilt a regular Job at
that level — and everything below it falls back under fail-fast rules. The
grandchild's failure never makes it up to the circuit breaker, because it already
got blocked and handled by the regular parent right above it.

## Why Kotlin works this way

If a supervisor could block the failure of the **entire** child subtree, it would
disable fail-fast at every level below it — including levels where the author is
deliberately relying on fail-fast. The boundary has to be local, so that many
different boundaries can be composed within the same tree.

## Where people get it wrong

- Wrapping `supervisorScope` around the outermost layer and assuming "everything
  inside is now isolated". Wrong — only the level of children directly under it
  is isolated.
- To isolate a deeper level, put the boundary **at that exact level**:
  `supervisorScope` inside the middle `launch`, not at the root.

## What to look for on the graph

Find the `launch` node sitting in the middle. B's failure edge stops **right
there** — it doesn't continue up to the supervisor. Then, from that same node,
cancellation radiates down to A and C.
