## Mental model

Every coroutine hangs under a parent, forming **a tree**. This tree has exactly
one direction for cancellation: **cancel always goes DOWN**. Cancelling a node
cancels the entire branch below it, all the way to the leaves. There is no path
for cancel to go sideways to a sibling, and no path for it to go back up to the
parent.

Remember one sentence: *cancel goes down, failure goes up.* This lesson only
covers the first half.

## Why Kotlin works this way

This is **structured concurrency**. If a child coroutine had no parent, every time
you left a screen you'd have to remember to manually cancel every task you'd
launched — and forgetting one is a leak. With a tree, cancelling the root is
enough: no task outlives the scope that spawned it.

## Where people get it wrong

- Assuming `cancel()` kills the coroutine instantly. It doesn't: it **requests**
  cancellation. The coroutine only actually stops when it hits its next suspend
  point — see the lesson *Cancellation and cleanup*.
- Assuming that cancelling a child kills the parent too. It doesn't: cancellation
  only goes down.

## What to look for on the graph

An orange cancel edge radiates from the cancelled node down to **the entire**
child subtree — one edge per leaf. That is the picture of "goes down, all the way
to the end".
