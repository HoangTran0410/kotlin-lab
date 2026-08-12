## Mental model

`CoroutineContext` is **a bag** holding pieces of configuration, one piece per
kind: Job, Dispatcher, CoroutineName, ExceptionHandler. It combines with `+`, and
the piece **on the right overwrites** the piece of the same kind on the left.

A child **inherits** its parent's bag, then stacks its own pieces on top.
`withContext` is how you swap one piece **mid-flight** and automatically get it
back afterward — still the same coroutine, just a different thread.

## Why Kotlin works this way

The dispatcher shouldn't be a parameter on every single call, because it's a
concern of a whole region of code, not of one line. Letting it inherit down the
tree means you declare it once at the root, and everything below is automatically
right.

## Where people get it wrong

- Thinking `withContext(Dispatchers.IO)` creates a new coroutine. It doesn't — it's
  still the exact same coroutine, just a different thread. No child node appearing
  means nobody is running in parallel with you.
- Using `Dispatchers.IO` for CPU-heavy work. IO has a large pool because IO work
  just sits and waits; heavy computation should use `Default`.

## What to look for on the graph

The thread badge on the node switches from one pool to another and then **switches
back** — while the node itself stays a single, unbroken node from start to finish.
One coroutine, two threads, at different times.

In the pool strip under the graph, watch the same hop from the other side: a slot on
one pool empties, a slot on the other fills, and the arriving slot is marked at the
exact step it happens. The strip is also where `IO` versus `Default` stops being a
sentence and becomes a shape — eight boxes next to four. And the count beside the
slots (`+N suspended, holding no thread`) is the reason a pool that small is enough:
a coroutine parked in `delay` gave its thread back.
