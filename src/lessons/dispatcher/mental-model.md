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
