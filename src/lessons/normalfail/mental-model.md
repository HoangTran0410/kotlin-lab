## Mental model

The other half of the sentence from the *Job Tree* lesson: **failure goes UP**.

A child fails → the parent (a regular Job) treats that as itself failing → and
because it's failing, it **cancels all its remaining children**. So the real path
is a letter V: up one level, then fanning back down to all the siblings.

Siblings don't die from each other's error. They die because their **parent**
died.

## Why Kotlin works this way

This is called **fail-fast**. If you launch three tasks to build one combined
result, and one of them breaks, the other two are now doing wasted work — burning
time, burning battery, and possibly writing out half-finished data. Stopping the
whole group is the safe default.

When you *don't* want that, that's when you reach for a supervisor — that's the
next lesson.

## Where people get it wrong

- Assuming only the failed coroutine stops. It doesn't: the whole group stops.
- Assuming you can wrap `try/catch` around `launch` to keep the siblings alive.
  You can't — isolating them requires changing the **structure** (a supervisor),
  not moving where the `catch` sits.

## What to look for on the graph

One red failure edge going up, then two orange cancel edges going down to the two
siblings. That letter V is the whole lesson.
