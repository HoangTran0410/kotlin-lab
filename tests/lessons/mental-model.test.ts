import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LESSONS } from '../../src/lessons'
import { parseMarkdown } from '../../src/ui/mentalmodel/markdown'
import { UNSUPPORTED } from '../../src/engine/validator/diagnostics'

/**
 * The lesson prose is also something that can be wrong, and being wrong here is
 * worse than being wrong in code: nothing goes red, the learner just quietly
 * learns the wrong thing.
 *
 * Whatever can be checked by machine is checked here — every lesson has one,
 * has all four sections, and none of them introduces a construct the engine
 * would flag red the moment it's typed.
 */
const pathFor = (id: string) => join('src/lessons', id, 'mental-model.md')
const readDoc = (id: string) => readFileSync(pathFor(id), 'utf8')

const REQUIRED_SECTIONS = ['Mental model', 'Why Kotlin works this way', 'Where people get it wrong', 'What to look for on the graph']

describe('mental model — one per lesson', () => {
  it('none is missing', () => {
    for (const l of LESSONS) {
      expect(existsSync(pathFor(l.id)), `${l.id} has no mental-model.md`).toBe(true)
    }
  })

  it('each one has all four sections, in the right order', () => {
    // Order is part of the design: understand the model -> understand why ->
    // know where it goes wrong -> know what to look for. Reordering it means
    // "where it goes wrong" gets read before the reader even has a model to get
    // wrong.
    for (const l of LESSONS) {
      const headings = parseMarkdown(readDoc(l.id))
        .filter(k => k.k === 'h')
        .map(k => (k.k === 'h' ? k.content.map(d => d.v).join('') : ''))
      expect(headings, `${l.id} is missing sections or has them out of order`).toEqual(REQUIRED_SECTIONS)
    }
  })

  it('each section has real content, not just an empty heading', () => {
    for (const l of LESSONS) {
      const blocks = parseMarkdown(readDoc(l.id))
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i]!.k !== 'h') continue
        const next = blocks[i + 1]
        expect(next, `${l.id}: a section has nothing underneath it`).toBeDefined()
        expect(next!.k, `${l.id}: two headings are stuck together`).not.toBe('h')
      }
      expect(readDoc(l.id).length, `${l.id} is too short to be a mental model`).toBeGreaterThan(600)
    }
  })

  it('copyable code blocks contain no construct the engine would flag red', () => {
    // Only inspect ``` BLOCKS — the thing a learner selects and pastes into the
    // editor.
    //
    // The first version of this case also inspected `inline code`, and it went
    // red immediately: the `suspend` lesson writes "don't use `Thread.sleep()`"
    // in its *Where people get it wrong* section, and `Thread` is in
    // UNSUPPORTED. That sentence is correct and necessary — the rule was wrong,
    // not the content. Naming a real Kotlin API inline to say "don't use this"
    // or "this isn't supported here yet" is normal for lesson prose.
    //
    // Stating the scope plainly: today exactly ONE lesson has a ``` block (the
    // `parallel` lesson). This case exists so that a second block — and any
    // after it — doesn't slip through, not because it's currently guarding
    // against much.
    for (const l of LESSONS) {
      const code = parseMarkdown(readDoc(l.id)).flatMap(k => (k.k === 'code' ? [k.text] : []))
      for (const snippet of code) {
        for (const forbidden of Object.keys(UNSUPPORTED)) {
          expect(snippet.includes(forbidden), `${l.id}: sample code uses ${forbidden}, the engine would flag it red`).toBe(false)
        }
      }
    }
  })
})
