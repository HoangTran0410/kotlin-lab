/**
 * What this engine can run — as DATA, not a wall of text.
 *
 * Each entry carries an actual runnable Kotlin program and the output it
 * MUST print. `tests/ui/capabilities.test.ts` runs every one of them and
 * compares output line by line, so this list can't lie: a construct that
 * gets removed from the engine but is still listed here turns the test red,
 * instead of a learner discovering it by typing it and watching nothing
 * happen.
 *
 * In exchange, every entry is also an EXAMPLE that opens straight into the
 * editor — the feature list and the example set are the same thing, not two
 * things that can drift apart.
 *
 * The "doesn't run yet" list is NOT here: it's derived straight from the
 * validator's UNSUPPORTED table (see AboutPanel), so it can't drift either.
 */
export interface Capability {
  /** Name shown on the card. If several related names belong together, write the whole group. */
  name: string
  /** One sentence: what it does, or what it teaches. */
  summary: string
  /** A complete, runnable program that can be opened straight into the editor. */
  kotlin: string
  /** Output it MUST print. The test compares line by line. */
  output: string[]
}

export interface CapabilityGroup {
  title: string
  items: Capability[]
}

const mainBlock = (body: string): string => `import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n${body}\n}\n`

export const CAPABILITIES: CapabilityGroup[] = [
  {
    title: 'Create coroutines',
    items: [
      {
        name: 'launch { }',
        summary: 'Creates a child coroutine that runs concurrently, returns a Job. Carries no return value.',
        kotlin: mainBlock(`    val job = launch {
        delay(50)
        println("child finished running")
    }
    println("parent moves on immediately, without waiting")
    job.join()`),
        output: ['parent moves on immediately, without waiting', 'child finished running'],
      },
      {
        name: 'async { } / await()',
        summary: 'Like launch but returns a Deferred — await() both waits and retrieves the value.',
        kotlin: mainBlock(`    val n = async {
        delay(50)
        7
    }
    println("await() returns: " + n.await())`),
        output: ['await() returns: 7'],
      },
      {
        name: 'coroutineScope { }',
        summary: 'Runs inline, only returns once EVERY child is done. One child failing fails the whole scope.',
        kotlin: mainBlock(`    coroutineScope {
        launch { delay(80); println("A") }
        launch { delay(20); println("B") }
    }
    println("scope returns once both A and B are done")`),
        output: ['B', 'A', 'scope returns once both A and B are done'],
      },
      {
        name: 'supervisorScope { }',
        summary: "Like coroutineScope, but a child's failure stops DIRECTLY at the boundary.",
        kotlin: mainBlock(`    supervisorScope {
        launch { delay(20); throw RuntimeException("boom") }
        launch { delay(80); println("sibling is still alive") }
    }`),
        output: ['sibling is still alive'],
      },
      {
        name: 'withContext(...)',
        summary: 'Switches dispatcher partway through, then switches back. Still the SAME coroutine.',
        kotlin: mainBlock(`    println("runBlocking's body runs on Main")
    withContext(Dispatchers.IO) {
        println("this block runs on the IO pool")
    }
    println("leaving withContext returns to Main")`),
        output: [
          "runBlocking's body runs on Main",
          'this block runs on the IO pool',
          'leaving withContext returns to Main',
        ],
      },
      {
        name: 'CoroutineScope(...) / MainScope()',
        summary: "A self-managed scope with its own root Job — it doesn't hang off the calling coroutine.",
        kotlin: mainBlock(`    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    scope.launch { delay(500); println("doesn't make it in time to print") }
    delay(50)
    scope.cancel()
    println("cancel() on a scope cancels all of its children")`),
        output: ['cancel() on a scope cancels all of its children'],
      },
      {
        name: 'GlobalScope.launch { }',
        summary: 'No parent. Nobody waits for it, nobody cancels it, and it dies with the program.',
        kotlin: mainBlock(`    GlobalScope.launch { delay(500); println("never prints") }
    delay(50)
    println("main is done, that coroutine gets left behind")`),
        output: ['main is done, that coroutine gets left behind'],
      },
    ],
  },
  {
    title: 'Stop, wait, cancel',
    items: [
      {
        name: 'delay(ms) / yield()',
        summary: "Two suspension points: release the thread for someone else to use, don't block it.",
        kotlin: mainBlock(`    launch { println("A1"); yield(); println("A2") }
    launch { println("B1"); yield(); println("B2") }
    delay(10)`),
        output: ['A1', 'B1', 'A2', 'B2'],
      },
      {
        name: 'join() / cancel() / cancelAndJoin()',
        summary: "join only waits. cancel doesn't wait. cancelAndJoin cancels AND THEN waits for cleanup to finish.",
        kotlin: mainBlock(`    val job = launch {
        try { delay(500) } finally { println("cleanup") }
    }
    delay(20)
    job.cancelAndJoin()
    println("only gets here once cleanup is done")`),
        output: ['cleanup', 'only gets here once cleanup is done'],
      },
      {
        name: 'isActive / isCancelled / isCompleted',
        summary: "Job state readable from code. A coroutine that's SUSPENDED still has an Active Job.",
        kotlin: mainBlock(`    val job = launch { delay(100) }
    delay(10)
    println("mid-delay: isActive = " + job.isActive)
    job.join()
    println("done: isCompleted = " + job.isCompleted)`),
        output: ['mid-delay: isActive = true', 'done: isCompleted = true'],
      },
      {
        name: 'ensureActive()',
        summary: 'Throws right on the spot if already cancelled — no need to wait for the next suspension point.',
        kotlin: mainBlock(`    val job = launch {
        try {
            delay(100)
            ensureActive()
            println("never gets here")
        } finally { println("finally still runs") }
    }
    delay(20)
    job.cancelAndJoin()`),
        output: ['finally still runs'],
      },
    ],
  },
  {
    title: 'Context and dispatcher',
    items: [
      {
        name: 'Dispatchers.Main / Default / IO / Unconfined',
        summary: "Four virtual thread pools. A child inherits its parent's dispatcher unless told otherwise.",
        kotlin: mainBlock(`    launch(Dispatchers.Default) { println("Default") }
    launch(Dispatchers.IO) { println("IO") }
    delay(10)`),
        output: ['Default', 'IO'],
      },
      {
        name: 'CoroutineName("...")',
        summary: 'Names a coroutine. This name always shows on the graph node.',
        kotlin: mainBlock(`    val job = launch(CoroutineName("worker")) { println("look at the node name on the right") }
    job.join()`),
        output: ['look at the node name on the right'],
      },
      {
        name: 'SupervisorJob() / Job() / operator +',
        summary: 'Adds elements together into a context. The element on the right overrides the one on the left.',
        kotlin: mainBlock(`    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("worker"))
    scope.launch { println("inherits all three elements from the scope") }
    delay(10)
    scope.cancel()`),
        output: ['inherits all three elements from the scope'],
      },
    ],
  },
  {
    title: 'Plain Kotlin',
    items: [
      {
        name: 'suspend fun',
        summary: 'A function that can call suspension points. Calling it looks exactly like calling a regular function.',
        kotlin: `import kotlinx.coroutines.*

suspend fun load(name: String): String {
    delay(50)
    return "done " + name
}

fun main() = runBlocking {
    println(load("friend"))
}
`,
        output: ['done friend'],
      },
      {
        name: 'try / catch / finally, throw, error(...)',
        summary: "finally runs even when the coroutine is cancelled — that's where cleanup happens.",
        kotlin: mainBlock(`    try {
        error("broken")
    } catch (e: IllegalStateException) {
        println("caught: " + e.message)
    } finally {
        println("finally")
    }`),
        output: ['caught: broken', 'finally'],
      },
      {
        name: 'if / when / while / for / repeat',
        summary: 'for runs over a range a..b. repeat(n) { } receives the implicit variable it.',
        kotlin: mainBlock(`    for (i in 1..3) {
        val label = when (i) {
            1 -> "one"
            2 -> "two"
            else -> "many"
        }
        println(i.toString() + " = " + label)
    }
    repeat(2) { println("round " + it) }`),
        output: ['1 = one', '2 = two', '3 = many', 'round 0', 'round 1'],
      },
      {
        name: 'val / var, string templates ${...}',
        summary: 'Variables, integer arithmetic, and embedding expressions in a string.',
        kotlin: mainBlock(`    val a = 6
    var b = 7
    b = b + 1
    println("\${a} x \${b} = \${a * b}")`),
        output: ['6 x 8 = 48'],
      },
    ],
  },
]
