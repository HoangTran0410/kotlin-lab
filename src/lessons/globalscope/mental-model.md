## Mental model

`GlobalScope.launch { }` is a coroutine **with no parent**. Drop the parent and you
lose all four of these at once:

- nobody **waits** for it,
- nobody **cancels** it,
- its failure has nowhere to go,
- and it **doesn't outlive the process** — when the program ends, it vanishes
  mid-flight, possibly right in the middle of a `delay`.

It's not "a global coroutine that lives forever". It's an **orphan** coroutine.

## Why Kotlin works this way

`GlobalScope` is marked `@DelicateCoroutinesApi` — the library authors themselves
consider it a tool that's easy to misuse. It exists for a handful of rare
infrastructure-level cases, where the real lifecycle is the lifecycle of the whole
application.

What you almost always need instead is a scope with a clear lifecycle:
`viewModelScope`, `lifecycleScope`, or a `CoroutineScope(SupervisorJob())` that you
build yourself and `cancel()` yourself.

## Where people get it wrong

- Using `GlobalScope` so a coroutine "won't get cancelled when the screen closes".
  That is exactly a leak: it keeps running, still holding a reference to a screen
  that's already dead.
- Assuming it runs to completion before the program exits. Nobody is waiting for
  it at all.

## What to look for on the graph

It stands **as its own tree**, with no edge connecting up to the `runBlocking`
node. And at the final step, it's still sitting in a suspended state — there is
never a resume step for it.
