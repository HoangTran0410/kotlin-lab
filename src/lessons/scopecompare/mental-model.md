## Mental model

Two blocks with **an identical body**, differing by exactly one word in the
function name, produce two opposite results. This lesson exists to show that what
decides the behavior isn't in the code you write, it's in **the parent's kind of
Job**.

- `coroutineScope` → a regular Job → if a child fails, the whole group dies, and
  the error gets **thrown to the caller** (catchable with `try/catch`).
- `supervisorScope` → a supervisor boundary → if a child fails, it stops right
  there, and the caller **sees nothing**.

## Why Kotlin works this way

Two real, opposing needs: "all or nothing" (loading a page needs all three pieces
of data) and "whoever breaks, breaks alone" (three independent widgets). Both are
correct, depending on the situation — so Kotlin gives you two functions, not one
function with a flag.

## Where people get it wrong

- Using `supervisorScope` just to avoid seeing a crash. A swallowed failure is
  still a failure; you need somewhere to **handle** it, not just somewhere for it
  to disappear.
- Assuming `try/catch` around `supervisorScope` will catch a child's error. There
  is nothing thrown outward to catch.

## What to look for on the graph

Run to the end, then scrub backward: the top half has cancel edges fanning down
to the siblings, the bottom half doesn't. Same tree shape, different only in
exactly those edges.
