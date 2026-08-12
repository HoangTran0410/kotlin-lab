## Mental model

Same mechanism, different in exactly one place: **does anyone read the result**.

- `launch` → `Job`. `join()` only **waits**. There is no value to grab, so there's
  also no place for an exception to surface to you.
- `async` → `Deferred`. `await()` both waits and **reads**. And because there's a
  place to read from, the exception gets re-thrown **at the exact line that calls
  `await()`**.

So the question to decide with isn't "which one is more modern" but: *do I need
the return value?*

## Why Kotlin works this way

A `Deferred` is a promise of a value. A promise that fails has to deliver that
failure to whoever is waiting for it — like `Promise.reject`. A `Job` doesn't
promise anything, so its error has exactly one path to travel: up to the parent.

## Where people get it wrong

- `async { }` and then **not** calling `await()`. The error inside stays silent
  until someone reads it — or forever.
- Assuming `await()` is the *only* place the error gets handled. It isn't:
  `async` is still a child in the tree, so the failure still climbs to the parent
  in parallel with waiting to be `await()`ed. This is exactly why the lesson uses
  `supervisorScope`.

## What to look for on the graph

The `async` node holds its failed state for a whole stretch — scrub through the
steps and you'll see it had already failed long before anyone read it.
