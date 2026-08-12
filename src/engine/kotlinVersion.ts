/**
 * The Kotlin version this engine's semantics are CROSS-CHECKED against.
 *
 * Not "the engine supports Kotlin 2.1.20" — it doesn't compile Kotlin, it
 * simulates a subset of it. This is the real compiler version number that
 * every "what does Kotlin actually do here?" question gets taken to: each
 * lesson's `expected-jvm-output.txt` fixture is pulled from exactly this
 * build, and so is every "cross-checked against real Kotlin" note scattered
 * through src/engine.
 *
 * One single constant for all three places that need it: the fixture-fetch
 * script (builds the API URL), the about page (shown to learners), and the
 * JVM cross-check test.
 */
export const KOTLIN_VERSION = '2.1.20'

/** Kotlin Playground API — the oracle used to fetch real JVM output. */
export const PLAYGROUND_API = `https://api.kotlinlang.org/api/${KOTLIN_VERSION}/compiler/run`
