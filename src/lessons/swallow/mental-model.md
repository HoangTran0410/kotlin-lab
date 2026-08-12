## Mental model

The cancellation signal travels through the system in the shape of **a perfectly
ordinary exception**: `CancellationException`. It is a subclass of `Exception`.
So `catch (e: Exception)` catches it — catching the very cancellation you never
meant to catch.

After swallowing it, the coroutine body keeps running as if nothing happened,
while the Job is already Cancelled. The two are telling two different stories
about the same coroutine.

## Why Kotlin works this way

Using the exception mechanism itself to carry the cancellation signal is how
`finally` and existing `try/finally` blocks automatically run correctly — without
needing a second unwind path running parallel to the language's own. The price
paid is exactly this: it can be caught.

## Where people get it wrong

- `try { ... } catch (e: Exception) { log(e) }` wrapped around a block containing
  a suspend point. This is the single most common silent bug when working with
  coroutines.
- Narrowing the catch still isn't enough if you `catch (e: Throwable)`.

The correct approach: catch exactly the kind of error you can handle, or re-throw
when you encounter a `CancellationException`.

## What to look for on the graph

The node switches to a cancelled state **first**, then keeps printing two more
lines anyway. State and behavior diverge — that's exactly what makes this bug
hard to spot in logs.
