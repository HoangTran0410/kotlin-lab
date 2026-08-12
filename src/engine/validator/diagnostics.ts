export interface Diagnostic {
  severity: 'error'
  message: string
  line: number
  col: number
  hint?: string
}

/** Name -> replacement hint. The key is the identifier as it appears in the source. */
export const UNSUPPORTED: Record<string, string> = {
  Channel: 'Channel is not available in v1 yet. Use Flow to model a stream of values.',
  produce: 'produce is not available in v1 yet. Use flow { emit(...) }.',
  actor: 'actor is not available in v1 yet.',
  select: 'select is not available in v1 yet. Split it into separate await() branches.',
  Mutex: 'Mutex is not available in v1 yet. M1 does not simulate resource contention yet.',
  withLock: 'withLock is not available in v1 yet (it comes with Mutex).',
  Semaphore: 'Semaphore is not available in v1 yet.',
  buffer: 'The buffer operator is not available in v1 yet.',
  conflate: 'The conflate operator is not available in v1 yet.',
  debounce: 'The debounce operator is not available in v1 yet.',
  combine: 'The combine operator is not available in v1 yet.',
  zip: 'The zip operator is not available in v1 yet.',
  suspendCoroutine: 'suspendCoroutine is not available in v1 yet.',
  suspendCancellableCoroutine: 'suspendCancellableCoroutine is not available in v1 yet.',

  flow: 'Flow builders are not available in this version yet.',
  flowOf: 'flowOf is not available in this version yet.',
  asFlow: 'asFlow is not available in this version yet.',
  collect: 'Flow collection is not available in this version yet.',
  emit: 'Flow emission is not available in this version yet.',
  launchIn: 'launchIn is not available in this version yet.',
  MutableStateFlow: 'MutableStateFlow is not available in this version yet.',

  CoroutineStart: 'Explicit CoroutineStart modes are not modeled. Omit start= to use CoroutineStart.DEFAULT.',

  // ---- In subset §4.1 but DEFERRED past M1 ----
  // Different from the group above: these names WILL exist, just not yet.
  // They have to be listed here because the parser can read them, so if they
  // weren't declared they'd fall through to the last branch of evalCall and
  // return Unit SILENTLY: withTimeout(100) { } would run nothing and report
  // nothing, listOf(1).forEach { } would print nothing, println(j.getCompleted())
  // would print the literal string "kotlin.Unit". Deferred must mean REPORTED.
  invokeOnCompletion: 'invokeOnCompletion is not available in M1 yet. Look at the job state on the trace instead of attaching a callback.',
  getCompleted: 'getCompleted() is not available in M1 yet. Use await().',
  coroutineContext: 'coroutineContext is not available in M1 yet. Context shows up on the trace of each coroutine.',
  listOf: 'Collections are not available in M1 yet. Use for (i in 1..n) instead of a list.',
  mutableListOf: 'Collections are not available in M1 yet. Use for (i in 1..n) instead of a list.',
  forEach: 'forEach is not available in M1 yet. Use for (i in 1..n) or repeat(n).',

  // ---- Outside M3's scope, or deferred to a later milestone ----
  // children is a Sequence<Job> — supporting it drags in the whole sequence
  // API, out of scope for M3. The job tree is already shown on the graph.
  children: 'The job tree is already shown on the graph — look at the graph instead of walking job.children.',
  // A real Thread (as opposed to the engine's virtual Thread) is deferred to
  // Task 7, when a bridge to virtual threads exists. Before that,
  // Thread.currentThread() used to silently return Unit and print
  // "kotlin.Unit" — wrong without a trace.
  Thread: 'The virtual thread shows up on the graph and on the timeline. Check the node\'s thread badge.',
  currentThread: 'The virtual thread shows up on the graph and on the timeline. Check the node\'s thread badge.',

}
