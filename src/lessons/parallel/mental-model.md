## Mental model

`async` does **not** make anything run faster by itself. What makes things faster
is **the gap between where you start it and where you wait for it**.

```
val a = async { ... }   ← starts
val b = async { ... }   ← starts (a is still running)
a.await() + b.await()   ← only now do we wait
```

Writing `async { }.await()` on a single line collapses right back into sequential
— it just costs one extra object.

## Why Kotlin works this way

`async` returns immediately, and it has to: if it waited before returning, there
would be no way left to express "run two things at the same time". The decision
of *where to wait* is left to the person writing the code — that's exactly the
spot where parallelism gets placed.

## Where people get it wrong

- `val a = async { ... }.await()` followed by `val b = async { ... }.await()`:
  sequential in disguise, and this is the single most common mistake when people
  first use `async`.
- Wrapping everything in `async` "to make it faster". When the work is already
  sequential in terms of data (b needs a's result), there is nothing left to
  parallelize.

## What to look for on the graph

**The clock**, not the output — both halves print the exact same result. The
first half costs 400ms, the second costs 200ms. Drag the timeline and watch the
two `async` nodes overlap over the same stretch.
