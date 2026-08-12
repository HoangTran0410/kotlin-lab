import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from '../../src/ui/about/capabilities'
import { UNSUPPORTED } from '../../src/engine/validator/diagnostics'
import { runSource } from '../../src/engine/run'

/**
 * The "what can this tool run?" page lying is worse than a missing feature:
 * learners read it, believe it runs, type it in, and get silence or an
 * error. So every entry in the list is ACTUALLY RUN here and its output
 * compared line by line.
 */
const all = CAPABILITIES.flatMap(g => g.items)

describe('about page — every "runs" entry actually runs', () => {
  for (const k of all) {
    it(`${k.name}: compiles clean and prints exactly the recorded output`, () => {
      const r = runSource(k.kotlin)
      expect(r.diagnostics, `${k.name} produced diagnostics`).toEqual([])
      expect(r.output, `${k.name} printed something different from the output on the card`).toEqual(k.output)
    })
  }

  it('every entry has a name, a summary, and at least one line of output', () => {
    // An entry with `output: []` would sail through the case above without
    // proving anything: a program that prints nothing also matches. This
    // forces every example to have a visible result.
    for (const k of all) {
      expect(k.name.length, 'entry is missing a name').toBeGreaterThan(1)
      expect(k.summary.length, `${k.name} is missing a summary`).toBeGreaterThan(10)
      expect(k.output.length, `${k.name} prints nothing — the example isn't observable`).toBeGreaterThan(0)
    }
  })

  it('no entry uses a name that is in the NOT-supported list', () => {
    // The two lists sit side by side on the same page. If a construct just
    // got implemented (removed from UNSUPPORTED) or just got deferred (added
    // to UNSUPPORTED) and only one side got updated, a reader sees the same
    // name in both columns.
    //
    // Scans CODE only, with string literals stripped out first. The naive
    // substring version flagged the CoroutineScope example for the word
    // "children" — inside `println("cancel() on a scope cancels all of its
    // children")`. That is English prose, not a use of `job.children`; the
    // rule was wrong, not the example. Word boundaries too, so `Job` doesn't
    // match inside `SupervisorJob`.
    const codeOnly = (src: string): string => src.replace(/"(?:[^"\\]|\\.)*"/g, '""')
    for (const k of all) {
      const code = codeOnly(k.kotlin)
      for (const name of Object.keys(UNSUPPORTED)) {
        expect(new RegExp(`\\b${name}\\b`).test(code),
          `example "${k.name}" uses ${name} — which is in the not-supported column`).toBe(false)
      }
    }
  })
})
