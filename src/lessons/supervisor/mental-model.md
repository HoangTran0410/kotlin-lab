## Mental model

A supervisor is a **circuit breaker** sitting on the path failure travels up.
A child fails, the signal climbs up to the supervisor boundary, and stops there:
the parent doesn't consider itself broken, so it doesn't cancel its remaining
children.

Exactly one direction is blocked. Cancellation going down still passes through
normally: cancelling a `supervisorScope` still cleanly cancels all of its
children.

## Why Kotlin works this way

There are groups of work whose members are **independent** of each other: three
widgets on one screen, five image-loading requests. One breaking has no reason to
drag the other four down with it. That's when you want to isolate the failure
while still keeping the benefit of the job tree (one cancel cleans up everything).

## Where people get it wrong

- Using `SupervisorJob()` as a universal shield. It only blocks the failure of its
  **direct child** — see the lesson *The nested trap*.
- Passing `SupervisorJob()` as an argument to `launch`: `launch(SupervisorJob())`.
  This creates a job that **leaves** the tree instead of placing a supervisor
  boundary. The boundary belongs at `supervisorScope { }` or at
  `CoroutineScope(SupervisorJob())`.

## What to look for on the graph

A failure edge goes up and **stops** at the supervisor node — no cancel edge
radiates out from it. Compare it directly with the previous lesson's shape.
