## Mental model

**Exception** and **failure** are two different things.

- An *exception* is a value flying up the call stack. Catch it and it's over.
- A *failure* is the state of a **Job**: it ended abnormally, and that becomes its
  parent's problem.

An exception only becomes a failure once it **escapes the coroutine body**. If it's
caught inside, the Job never learns that anything happened.

## Why Kotlin works this way

A coroutine doesn't share a call stack with the place that launched it. `launch { }`
returns right away, so there is nobody standing there to wrap it in `try/catch`.
That's why Kotlin needs a second path to carry errors: the path of the **job
tree** — the thing this lesson and the next three lessons are about.

## Where people get it wrong

- `try { launch { throw ... } } catch (e: Exception) { }`. This `catch` block
  **never** runs: `launch` already returned long ago, and the exception happens
  somewhere else, at a different time. To catch it, wrap `coroutineScope { }`, or
  put `try/catch` **inside** the launch body.
- Assuming that catching the exception means the job is "still green". True — but
  only if it's caught **inside**.

## What to look for on the graph

In the first half: there's a "caught it" line and no failure edge leaves the node.
In the second half: the exception escapes, and a failure edge immediately appears
going **up** to the parent.
