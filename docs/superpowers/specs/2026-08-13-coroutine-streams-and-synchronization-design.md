# Coroutine Streams and Synchronization — Design

**Date:** 2026-08-13  
**Status:** Scope A approved; written-spec review pending  
**Amends:** `2026-08-11-kotlin-coroutines-lab-design.md` §4.1, §11 M4, and §13

## 1. Goal

Extend the deterministic Kotlin coroutine simulator with one coherent educational surface for:

- cold `Flow`, `StateFlow`, and `SharedFlow`;
- rendezvous and bounded buffered `Channel`;
- FIFO `Mutex` and `Semaphore`;
- biased `select` across channel receive, deferred await, and timeout clauses;
- trace-driven visualization, narration, capabilities, and lessons for every newly executable API.

The simulator remains honest: syntax or overloads outside the explicit subset produce diagnostics instead of executing approximately or returning `Unit` silently.

## 2. Supported source surface

### 2.1 Cold Flow

- `flow { emit(value) }`
- `flowOf(v1, v2, ...)`
- `(a..b).asFlow()`; other collection receivers remain unsupported while collections are unsupported
- terminal operators `collect { value -> ... }` and `collectLatest { value -> ... }`
- intermediate operators `map`, `filter`, `onEach`, `catch`, `onCompletion`, and `take`
- context and lifecycle operators `flowOn(dispatcher)` and `launchIn(scope)`

Each collection starts the cold upstream again. Without `flowOn`, upstream emission and downstream collection execute sequentially in the collector coroutine. `emit` does not return until the downstream chain has processed that value.

`catch` handles upstream failures only and never swallows cancellation. `onCompletion` runs once with `null` after normal completion or the failure cause after exceptional completion. `take(n)` completes after `n` accepted values and is the supported way to bound a hot-flow example.

`collectLatest` runs each action as structured work owned by the collecting coroutine. A new value cancels and joins the previous action before the next action starts. Normal upstream completion joins the final action.

`flowOn(ctx)` creates the real upstream coroutine/context boundary and changes only the preceding portion of the chain. Downstream operators and the terminal collector retain the collector context. When the dispatcher changes, the handoff uses kotlinx.coroutines' default buffered capacity of 64 values; the UI must show the upstream coroutine instead of pretending the whole chain stayed inline.

`launchIn(scope)` is semantically equivalent to `scope.launch { flow.collect() }` and returns the resulting `Job`.

### 2.2 StateFlow

- `MutableStateFlow(initialValue)`
- `.value` read and assignment
- collection through the Flow terminal operators above

A StateFlow is hot, immediately gives a new collector its current value, suppresses consecutive updates equal to the current value, and never completes normally. Assigning `.value` is non-suspending. A collecting coroutine must therefore be bounded with `take`, timeout, or cancellation.

`StateFlow` is the read-only conceptual surface shown in capabilities and lessons; this milestone does not add Kotlin static type enforcement or `asStateFlow()`.

### 2.3 SharedFlow

- `MutableSharedFlow()` with its default configuration only
- `.emit(value)`
- collection through the Flow terminal operators above

The supported SharedFlow has `replay = 0` and no extra buffer. It is hot and never completes normally. An emission with no subscribers is dropped immediately. With subscribers, `emit` resumes only after every subscriber present for that emission has accepted it. Each subscriber receives values in emission order.

`SharedFlow` is the read-only conceptual surface shown in capabilities and lessons; replay, extra buffer capacity, overflow policy, `tryEmit`, `replayCache`, and `asSharedFlow()` remain unsupported.

### 2.4 Channel

- `Channel<T>()` for rendezvous capacity `0`
- `Channel<T>(capacity)` for an integer capacity greater than or equal to `0`
- `.send(value)`, `.receive()`, and `.close()`

A rendezvous send and receive meet directly. A bounded channel queues up to `capacity` values. A send suspends when no receiver or free buffer slot exists; a receive suspends when no value exists. Waiting senders and receivers are served FIFO.

Normal `close()` rejects subsequent sends, preserves already-buffered values, and lets receivers drain them before a later `receive()` throws `ClosedReceiveChannelException`. A sender already suspended before normal close may still complete if a receiver accepts its value, matching the documented channel contract. Close causes, channel cancellation, iteration, `produce`, `actor`, capacity constants, overflow policies, `trySend`, `tryReceive`, and catching receive variants remain unsupported.

### 2.5 Mutex

- `Mutex()`
- `.lock()`, `.unlock()`, and `.withLock { ... }`

The mutex is non-reentrant and fair: suspended lockers acquire in FIFO order. `lock()` is cancellable while waiting. `withLock` releases in `finally` on normal return, failure, or cancellation. Calling `unlock()` while unlocked throws `IllegalStateException`.

Owner tokens, `tryLock`, `holdsLock`, and `isLocked` remain unsupported in this milestone.

### 2.6 Semaphore

- `Semaphore(permits)` with `permits > 0`
- `.acquire()`, `.release()`, and `.withPermit { ... }`

Each acquire takes one permit or suspends. Suspended acquirers are resumed FIFO. `acquire()` is cancellable while waiting. `withPermit` releases in `finally` on normal return, failure, or cancellation. Releasing more permits than the configured maximum throws `IllegalStateException`.

`acquiredPermits`, `tryAcquire`, and `availablePermits` remain unsupported.

### 2.7 Select

Supported form:

```kotlin
val result = select {
    channel.onReceive { value -> value }
    deferred.onAwait { value -> value }
    onTimeout(100) { fallback }
}
```

- at least two clauses;
- `ReceiveChannel.onReceive`, `Deferred.onAwait`, and `onTimeout(ms)` clauses;
- the selected clause's lambda result becomes the value of `select`;
- when several clauses are immediately ready, source order wins;
- once a clause wins, all losing registrations and timers are removed atomically;
- cancellation removes the complete selection from every resource queue.

`selectUnbiased`, `whileSelect`, `onSend`, `onJoin`, and other clauses remain unsupported.

## 3. Runtime architecture

### 3.1 Values and flow plans

Interpreter values gain opaque runtime references for flows and synchronization resources. Cold flows are immutable plans: a builder plus an ordered operator list. Collecting creates fresh execution state; constructing a cold flow executes no learner code.

Hot flows, channels, mutexes, and semaphores live in focused runtime modules owned by the scheduler. The interpreter never keeps separate waiter queues. This preserves one authority for readiness, cancellation, FIFO ordering, and virtual time.

### 3.2 Unified cancellable waits

The scheduler's suspension protocol gains resource operations for flow collection/emission, channel send/receive, mutex lock, semaphore acquire, and select. Every parked operation carries a registration token. Resumption or cancellation consumes that token exactly once and removes it from all queues.

This prevents stale cancelled receivers from consuming values, stale senders from delivering twice, and losing select clauses from firing after a winner has resumed the task.

### 3.3 Structured cleanup

`collectLatest`, `flowOn`, and `launchIn` use real scheduler jobs and existing propagation rules. `withLock` and `withPermit` are generator `try/finally` constructs so cleanup survives suspension, exception, and cancellation.

Synchronization resources do not become Job parents and do not alter failure propagation.

### 3.4 Quiescence and deadlock

If no task is ready, no timer remains, and the root is still active only because it is parked on resources that cannot progress, execution fails with a clear runtime diagnostic naming the blocked operations. It must never return a plausible partial trace as if execution completed.

An intentionally live hot-flow collector must be bounded by learner code; otherwise it is reported as suspended forever rather than silently accepted.

## 4. Trace and UI

Trace remains the sole source of truth. Add stable resource IDs and events for:

- flow creation, collection start, emission, and completion;
- channel creation, send, receive, and close;
- mutex acquire/release and semaphore acquire/release;
- select registration and the winning clause.

`COROUTINE_SUSPENDED.reason` expands with `collect`, `emit`, `send`, `receive`, `lock`, `permit`, and `select`. Every new event has virtual time, source line, and the responsible Job ID where applicable.

The trace fold derives current flow/resource state at every timeline step. The graph adds compact flow and resource nodes only for resources present in the program. A waiting Job is connected to its resource; the selected or delivered edge is highlighted at the active step. Existing Job layout and anti-jitter behavior remain unchanged.

Narration explains immediate versus suspended operations, backpressure, FIFO wakeups, StateFlow conflation, dropped zero-subscriber SharedFlow emissions, resource cleanup, and select winners. Capabilities and lessons execute their source and expected output in tests before being shown in the UI.

## 5. Validation and diagnostics

Validator receiver kinds expand to cold flow, mutable state flow, mutable shared flow, channel, mutex, and semaphore. Only methods valid for the inferred receiver kind execute. Direct constructor assignments and operator chains are supported; aliases or return shapes the validator cannot prove are rejected with an honest receiver-shape diagnostic.

Names become executable only when the runtime path and tests exist. Unsupported overloads remain in the central diagnostics table with a concrete supported alternative. The exhaustive “unsupported never returns Unit silently” test remains mandatory.

## 6. Verification strategy

Implementation follows red-green-refactor in vertical slices. Required coverage includes:

- cold re-collection, sequential emit, every operator, exception transparency, and context preservation;
- collectLatest cancellation and final-action join;
- StateFlow initial replay, equality conflation, multiple subscribers, and cancellation;
- SharedFlow zero-subscriber drop, multi-subscriber rendezvous, ordering, and cancellation;
- channel rendezvous, buffering, FIFO fairness, close/drain, failure, and cancelled waiters;
- mutex/semaphore FIFO fairness, cancellation, invalid release/unlock, and `finally` cleanup;
- select immediate bias, delayed winner, loser deregistration, timeout, cancellation, and exactly-once resume;
- deadlock diagnostics;
- trace folding, narration, graph nodes/edges, capabilities, and lessons;
- deterministic JVM parity fixtures for semantics whose order is deterministic.

Before integration: focused tests per slice, full `npm test`, typecheck/lint, production build, `git diff --check`, and an independent diff review.

## 7. Delivery boundaries

Implementation is split into dependency-aware stages:

1. shared resource-wait protocol and trace schema;
2. cold Flow and operators;
3. StateFlow and SharedFlow;
4. Channel;
5. Mutex and Semaphore;
6. select over the established wait sources;
7. trace fold, graph, narration, capabilities, and lessons;
8. integration verification and Kotlin parity checks.

Agents may work in parallel only where their files and scheduler contracts do not overlap. Scheduler protocol and trace schema land first; later agents build against that reviewed contract.

## 8. Explicit non-goals

- advanced Flow operators: `buffer`, `conflate`, `debounce`, `combine`, `zip`, `merge`, `flatMap*`, `shareIn`, and `stateIn`;
- channel builders and adapters: `produce`, `actor`, `channelFlow`, `callbackFlow`, `consumeAsFlow`, and iteration;
- overflow policies, special channel capacities, non-suspending try operations, and undelivered-element callbacks;
- owner-token synchronization overloads and unbiased selection;
- user-defined classes, interfaces, objects, or generic functions;
- exploration of nondeterministic scheduler interleavings.

These remain explicit diagnostics, not partial implementations.
