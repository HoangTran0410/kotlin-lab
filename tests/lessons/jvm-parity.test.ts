import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'

/**
 * Compares the simulator's output against the REAL output from running on the
 * JVM.
 *
 * The golden trace anchors the simulator to itself — it catches change, but if
 * the semantics were wrong from the start, it locks that wrongness in for good.
 * This is the one line that anchors it to real Kotlin.
 *
 * Fixtures were fetched ONCE from `api.kotlinlang.org` (Kotlin 2.1.20,
 * confType=java) and then committed. This test does NOT hit the network — it
 * runs offline.
 *
 * ── Why only some lessons have a fixture ────────────────────────────────────
 * Four lessons (`normalfail`, `supervisor`, `scopecompare`, `nestedtrap`)
 * DELIBERATELY let an uncaught exception reach the default handler — that is
 * exactly their lesson. On the playground's sandbox, once the stack trace hits
 * stderr, the process gets killed at a point that is NOT REPRODUCIBLE: the same
 * program shape has been measured to sometimes produce full output, sometimes
 * cut off mid-way (`scopecompare` produces 1 line, while a shortened version of
 * itself produces 2 lines). Writing that measurement into a fixture would freeze
 * the sandbox's nondeterminism, not Kotlin's semantics.
 *
 * So: where a fixture exists, compare strictly; where it doesn't, say exactly
 * why, rather than silently skipping it. The semantics of those four lessons are
 * anchored by each lesson's own dedicated tests (parent-child relationships,
 * propagation direction, `blockedBySupervisor`).
 */
const NO_FIXTURE: Record<string, string> = {
  normalfail: 'uncaught exception reaches the default handler — the playground sandbox kills the process non-reproducibly',
  supervisor: 'uncaught exception reaches the default handler — the playground sandbox kills the process non-reproducibly',
  scopecompare: 'uncaught exception reaches the default handler — the playground sandbox kills the process non-reproducibly',
  nestedtrap: 'uncaught exception reaches the default handler — the playground sandbox kills the process non-reproducibly',
}

const fixturePath = (id: string) => join('src/lessons', id, 'expected-jvm-output.txt')

const readFixture = (id: string): string[] => {
  const raw = readFileSync(fixturePath(id), 'utf8').split('\n')
  // The file always ends with a newline; drop the empty trailing element split() produces.
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  return raw
}

describe('compare against real JVM', () => {
  for (const l of LESSONS) {
    const reason = NO_FIXTURE[l.id]
    if (reason !== undefined) {
      it(`${l.id}: has NO fixture — ${reason}`, () => {
        // Assert the POSITIVE direction: the file must ACTUALLY not exist. If
        // someone adds a fixture for this lesson without removing it from the
        // exemption list, this case goes red — instead of the fixture just
        // sitting there, uncompared, unnoticed.
        expect(existsSync(fixturePath(l.id)), `${l.id} has a fixture but is still in the exemption list`).toBe(false)
      })
      continue
    }

    it(`${l.id}: simulator output matches real JVM output line for line`, () => {
      const jvm = readFixture(l.id)
      expect(runSource(loadLessonSource(l.id)).output).toEqual(jvm)
    })
  }

  it('every lesson is accounted for: either has a fixture, or has an exemption reason', () => {
    // Infrastructure guard rail. Without this case, a newly added lesson would
    // silently end up compared against nothing at all — the loop above would
    // still run, it just wouldn't generate any case for it.
    for (const l of LESSONS) {
      const hasFixture = existsSync(fixturePath(l.id))
      const isExempt = NO_FIXTURE[l.id] !== undefined
      expect(hasFixture || isExempt, `${l.id} has neither a fixture nor an exemption reason`).toBe(true)
    }
  })

  it('at least 5 lessons are anchored to real JVM output', () => {
    // Anti-drift threshold: if someone "fixes" a mismatch by deleting the fixture, this case goes red.
    const withFixture = LESSONS.filter(l => existsSync(fixturePath(l.id))).length
    expect(withFixture).toBeGreaterThanOrEqual(5)
  })
})
