# Kotlin Coroutines Lab

A tool for learning `kotlinx.coroutines`: write Kotlin, watch the coroutines run as
a graph.

It is a **simulator, not a compiler**. It reads a subset of Kotlin and replays
coroutine execution step by step so you can see it. Semantics are anchored to
**Kotlin 2.1.20** + `kotlinx.coroutines`, checked against a real JVM through the
Kotlin Playground API.

```
npm install
npm run dev        # open the app, edit Kotlin, scrub the trace live
npm test           # engine + UI
npm run typecheck
npm run lint
npm run build      # production build via Vite
npm run jvm:fetch  # refresh lesson fixtures from a real JVM (manual, needs network)
```

## How it works

The engine turns Kotlin source into an `Event[]`. `foldTrace(events, n)` rebuilds
the world at any step, which is what makes the timeline scrub in both directions:
there is one source of truth (the trace) and every view is a pure function of it.

The interpreter is a JS generator, so `finally` blocks run across suspension points
the way they do in Kotlin. Time is virtual — `delay(1000)` costs nothing and the
clock jumps to the next timer — and threads are virtual pools (`Main` 1, `Default`
4, `IO` 8) sized to stay readable on screen.

## What you see

- **Graph** — the job tree, with containment for parenthood, failure edges going up
  and cancel edges going down. Nodes carry the variable name you typed, the thread
  they are on, what they last printed, and the exception that killed them.
- **A sentence per step** under the graph, generated from the trace, so code you
  wrote yourself is explained too — nothing is hand-written per lesson.
- **Mental model** above the editor for each lesson: the model, why Kotlin is
  designed that way, where people get it wrong, and what to look for on the graph.
- **Deep debug** (off by default) — full console, per-event timeline, narration log.

## Lessons

Thirteen lessons in teaching order, from `suspend` through the supervisor rules to
`GlobalScope`. Nine of them have their output compared line by line against real
JVM output committed as a fixture. The other four deliberately let an uncaught
exception reach the default handler; the Playground sandbox kills that process at a
point that does not reproduce, so freezing that measurement would record sandbox
flakiness rather than Kotlin semantics — those four are anchored by per-lesson
semantic tests instead.

## Honesty rules this codebase holds itself to

- **No silent wrongness.** A construct the engine does not implement must be
  reported, never quietly evaluated to `Unit`. The "What can it run?" panel lists
  what is supported (every entry is executed by a test and its output compared) and
  what is not (read straight from the validator's table, so the two cannot drift).
- **Deterministic.** One program, one trace, every time. Real Kotlin is
  multi-threaded and may interleave differently — the app says so permanently.
- **Tests must be able to fail.** Assertions are red-checked by deliberately
  breaking the code they guard; where a test only guards a property rather than a
  line, the comment says so.

Design: `docs/superpowers/specs/2026-08-11-kotlin-coroutines-lab-design.md`
