## Mental model

`cancel()` is not a gunshot. It is **a letter**: it marks the Job as cancelling,
then waits. The letter is only read when the coroutine hits its next suspend point
(`delay`, `yield`, `join`, `await`) — that's when the suspend point **throws**
`CancellationException`.

Once it's an exception flying up the stack, every `finally` block on the way runs.
That is the one place you're allowed to trust for closing a file, unregistering, or
returning a connection.

## Why Kotlin works this way

Killing a thread mid-run is where leaked resources and corrupted state come from —
that's why `Thread.stop()` was put to death. Cancellation is **cooperative** in
exchange: the coroutine gets notified, unwinds cleanly, and gets to clean up.

`cancelAndJoin()` differs from `cancel()` in exactly one place: it **waits** for the
cleanup to finish before returning.

## Where people get it wrong

- Calling `cancel()` and immediately closing a shared resource, assuming the
  coroutine has already stopped. It hasn't — its `finally` might run **after**
  your very next line. Use `cancelAndJoin()`.
- Calling a suspend function inside `finally` to clean up: the coroutine is
  already cancelled, so that call throws immediately. (Real Kotlin solves this with
  `withContext(NonCancellable)` — not covered here yet.)

## What to look for on the graph

After the orange cancel edge, the node **still prints** the cleanup line. That is
visible proof that cancellation is not instant death.
