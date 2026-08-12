/**
 * Fetch each lesson's REAL output when run on the JVM, and write it to a fixture.
 *
 * Run by HAND (`npm run jvm:fetch [id...]`), not part of `npm test` — the test
 * suite only reads the committed fixture, so it can run offline. Passing no id
 * fetches all of them.
 *
 * Why this script exists instead of a copy-pasted curl one-liner: two safety
 * checks have to run EVERY TIME, and people always forget them when typing by
 * hand.
 *   1. `errors` contains an ERROR -> THROW, don't write the file. A lesson that
 *      doesn't compile on real Kotlin is a bug in the lesson, not something to
 *      record and move past.
 *   2. `exception` is non-null -> THROW. A program with an uncaught exception
 *      gets its process killed by the playground sandbox at a point that is NOT
 *      reproducible (measured: the same program shape sometimes produces 1 line,
 *      sometimes 2). Writing that measurement into a fixture freezes the
 *      sandbox's nondeterminism, not Kotlin's semantics — see the exemption list
 *      in tests/lessons/jvm-parity.test.ts.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LESSONS, loadLessonSource } from '../src/lessons/index'
import { PLAYGROUND_API } from '../src/engine/kotlinVersion'

const API = PLAYGROUND_API

interface KotlinError { severity: string; message: string; interval?: unknown }
interface RunResponse {
  errors?: Record<string, KotlinError[]>
  exception?: { message?: string; fullName?: string } | null
  text?: string
}

/** stdout lives inside the `<outStream>` tag of the `text` field. */
function outStream(text: string): string {
  const parts = [...text.matchAll(/<outStream>([\s\S]*?)<\/outStream>/g)]
  return parts.map(m => m[1] ?? '').join('')
}

async function fetchOne(id: string): Promise<void> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://play.kotlinlang.org' },
    body: JSON.stringify({
      args: '',
      files: [{ name: 'File.kt', publicId: '', text: loadLessonSource(id) }],
      confType: 'java',
    }),
  })
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`)
  const data = await res.json() as RunResponse

  const errors = (data.errors?.['File.kt'] ?? []).filter(e => e.severity === 'ERROR')
  if (errors.length > 0) {
    throw new Error(`${id}: does NOT compile on real Kotlin:\n`
      + errors.map(e => `  - ${e.message}`).join('\n'))
  }
  if (data.exception) {
    throw new Error(`${id}: the program threw an uncaught exception `
      + `(${data.exception.fullName ?? ''}: ${data.exception.message ?? ''}). `
      + 'The playground sandbox kills the process at a point that is not reproducible — not writing a fixture. '
      + 'Add this lesson to NO_FIXTURE in tests/lessons/jvm-parity.test.ts.')
  }

  const out = outStream(data.text ?? '')
  const path = join('src/lessons', id, 'expected-jvm-output.txt')
  writeFileSync(path, out.endsWith('\n') || out === '' ? out : `${out}\n`)
  console.log(`${id}: ${out.split('\n').filter(l => l !== '').length} lines -> ${path}`)
}

const ids = process.argv.slice(2)
const selected = ids.length > 0 ? ids : LESSONS.map(l => l.id)
for (const id of selected) {
  // Sequential + 1 second pause: it's a public API, don't fire 13 requests in parallel.
  await fetchOne(id)
  await new Promise(r => setTimeout(r, 1000))
}
