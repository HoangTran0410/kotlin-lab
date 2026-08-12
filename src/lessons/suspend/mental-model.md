## Mental model

Don't think of `delay()` as "sleeping". Think of it as **reserving a spot and
giving up the seat**: the coroutine records exactly which line it's standing at,
hands the thread back to the pool, and arranges to be called back at that exact
spot. The thread doesn't sit around waiting for anyone — it goes off to serve
another coroutine immediately.

This is where two states come from that beginners tend to merge into one:

- The **coroutine** is SUSPENDED — the function body is paused mid-flight,
  running no line at all.
- The **Job** is still ACTIVE — it's still alive, still in the tree, still
  cancellable, and its parent is still waiting on it.

## Why Kotlin works this way

The compiler slices every `suspend fun` into a state machine: each suspend point
becomes a label to jump back to. That "spot where it's standing" is called a
**continuation**, and it's an object on the heap — thousands of times cheaper
than a real thread. That's why running ten thousand coroutines on four threads is
completely ordinary.

## Where people get it wrong

- Assuming `job.isActive == false` the moment a coroutine is in `delay`. It
  isn't: while delaying, `isActive` is still `true`.
- Using `Thread.sleep()` instead of `delay()`. `sleep` **blocks** a real thread —
  it sits down in the seat and doesn't give it up, freezing the whole pool.

## What to look for on the graph

The node switches to a resting state at the moment of `delay`, but its border
does **not** switch to the finished color. The thread badge leaves the node —
the thread has gone off somewhere else.
