import { CAPABILITIES } from './capabilities'
import { UNSUPPORTED } from '../../engine/validator/diagnostics'
import { KOTLIN_VERSION } from '../../engine/kotlinVersion'
import { DISPATCHER_POOL_SIZE } from '../../engine/runtime/dispatcher'
import { LESSON_IDS_WITH_JVM_FIXTURE, LESSON_LIST } from '../../lessons/registry'

const CAPABILITY_SECTIONS = [
  { title: 'Core', names: ['launch { }', 'async { } / await()', 'suspend fun'] },
  { title: 'Context', names: ['withContext(...)', 'withContext(NonCancellable)', 'Dispatchers.Main / Default / IO / Unconfined', 'CoroutineName("...")', 'SupervisorJob() / Job() / operator +', 'CoroutineExceptionHandler'] },
  { title: 'Flow', names: ['coroutineScope { }', 'delay(ms) / yield()', 'try / catch / finally, throw, error(...)', 'if / when / while / for / repeat', 'val / var, string templates ${...}'] },
  { title: 'Advanced', names: ['supervisorScope { }', 'CoroutineScope(...) / MainScope()', 'GlobalScope.launch { }', 'withTimeout(...) / withTimeoutOrNull(...)', 'join() / cancel() / cancelAndJoin()', 'isActive / isCancelled / isCompleted', 'ensureActive()'] },
] as const

const ALL_CAPABILITIES = CAPABILITIES.flatMap(group => group.items)
const belongsIn = (name: string, group: { names: readonly string[] }): boolean => group.names.includes(name)

/**
 * "What can this tool run?" — the first question anyone opening the app for
 * the first time asks, and until now there was nowhere that answered it.
 * Learners had to type something and guess from the silence.
 *
 * The three columns of data here are all DERIVED, not hand-copied:
 *   - "runs": from `capabilities.ts`, where every entry is actually run in
 *     `tests/ui/capabilities.test.ts` and its output compared line by line.
 *   - "doesn't run yet": straight from the UNSUPPORTED table that the
 *     validator itself uses to report errors. The two lists can't drift
 *     apart because they ARE the same table.
 *   - thread pool: from the engine's DISPATCHER_POOL_SIZE.
 */
export function AboutContent({ onOpenExample }: { onOpenExample: (src: string) => void }) {
  const jvmLessonCount = LESSON_LIST.filter(l => LESSON_IDS_WITH_JVM_FIXTURE.has(l.id)).length

  return (
    <>
      <p className="about__sub">
        This is a <strong>simulation</strong>, not a Kotlin compiler. It reads a subset of Kotlin
        and plays out each step of a coroutine so you can see it happen.
      </p>
      <section className="about__sec">
            <h3>Which Kotlin it's pinned to</h3>
            <ul className="about__facts">
              <li>
                Semantics are checked against <strong>Kotlin {KOTLIN_VERSION}</strong> +
                kotlinx.coroutines, run on a real JVM via Kotlin Playground.
              </li>
              <li>
                <strong>{jvmLessonCount}/{LESSON_LIST.length} lessons</strong> have output checked
                line-by-line against a real JVM and committed as a fixture. The remaining lessons
                deliberately let an exception propagate uncaught to the default handler — at that
                point the Playground sandbox kills the process at a moment that isn't reproducible,
                so recording that measurement would just freeze the sandbox's nondeterminism, not
                Kotlin's semantics.
              </li>
              <li>
                Syntax: a subset — enough to write every lesson in the path, not enough to run
                production code. See the two lists below.
              </li>
            </ul>
          </section>

          <section className="about__sec">
            <h3>What runs — click to open straight into the editor</h3>
            {CAPABILITY_SECTIONS.map(group => (
              <section key={group.title} className="about__group" aria-label={group.title}>
                <h4>{group.title}</h4>
                <ul className="mdl__cards">
                  {ALL_CAPABILITIES.filter(k => belongsIn(k.name, group)).map(k => (
                    <li key={k.name} className="mdl__card">
                      <div className="mdl__cardHead">
                        <code className="about__ten">{k.name}</code>
                        <button
                          type="button"
                          className="about__try"
                          onClick={() => onOpenExample(k.kotlin)}
                        >
                          Open example
                        </button>
                      </div>
                      <p className="about__mo">{k.summary}</p>
                      <pre className="about__ra" aria-label={`Output for example ${k.name}`}>
                        {k.output.join('\n')}
                      </pre>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>

          <section className="about__sec">
            <h3>Not supported yet — typing it flags red, it doesn't fail silently</h3>
            <ul className="about__unsup">
              {Object.entries(UNSUPPORTED).map(([name, hint]) => (
                <li key={name}>
                  <code>{name}</code>
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="about__sec">
            <h3>Where it differs from real Kotlin</h3>
            <ul className="about__facts">
              <li>
                <strong>Execution order is unique.</strong> The same code always produces the same
                trace. Real Kotlin runs multi-threaded and can interleave differently — especially
                between coroutines that become ready at the same instant.
              </li>
              <li>
                <strong>The clock is virtual.</strong> <code>delay(1000)</code> doesn't cost a real
                second; it jumps straight to the next time mark. That's how you can compare 200ms
                against 400ms without actually waiting.
              </li>
              <li>
                <strong>Threads are virtual, and fewer than in reality,</strong> to fit the
                diagram. Unconfined's zero means no dedicated pool; its carrier is a deterministic
                approximation of whichever real thread resumes it:{' '}
                {Object.entries(DISPATCHER_POOL_SIZE).map(([d, n], i) => (
                  <span key={d}>{i > 0 ? ', ' : ''}<code>{d}</code> {n}</span>
                ))}.
              </li>
              <li>
                <strong>Resource contention isn't simulated.</strong> Two coroutines writing the
                same variable here will never produce a wrong result the way they could on a real
                JVM — race conditions are out of scope for this tool.
              </li>
            </ul>
      </section>
    </>
  )
}
