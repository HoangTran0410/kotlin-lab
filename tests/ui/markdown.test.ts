import { describe, expect, it } from 'vitest'
import { parseMarkdown, parseInline } from '../../src/ui/mentalmodel/markdown'

describe('minimal markdown reader', () => {
  it('`## x` becomes a heading, a plain line becomes a paragraph', () => {
    expect(parseMarkdown('## Model\na sentence.')).toEqual([
      { k: 'h', content: [{ t: 'text', v: 'Model' }] },
      { k: 'p', content: [{ t: 'text', v: 'a sentence.' }] },
    ])
  })

  it('two consecutive lines are ONE paragraph — markdown soft line breaks', () => {
    // Real content is wrapped at column 90 for readability in git diffs. If
    // every line became its own <p>, a lesson would render as disjointed
    // fragments.
    const r = parseMarkdown('first line\nsecond line.')
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ k: 'p', content: [{ t: 'text', v: 'first line second line.' }] })
  })

  it('a blank line breaks the paragraph', () => {
    expect(parseMarkdown('a\n\nb').filter(k => k.k === 'p')).toHaveLength(2)
  })

  it('dashes group into a single list', () => {
    const r = parseMarkdown('- one\n- two')
    expect(r).toEqual([{
      k: 'ul',
      items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]],
    }])
  })

  it('an indented line continues the item above, not a new paragraph', () => {
    const r = parseMarkdown('- long item\n  continued\n- second item')
    expect(r).toHaveLength(1)
    const list = r[0]!
    if (list.k !== 'ul') throw new Error('not a list')
    expect(list.items).toHaveLength(2)
    expect(list.items[0]).toEqual([{ t: 'text', v: 'long item continued' }])
  })

  it('a ``` block preserves line breaks and whitespace', () => {
    const r = parseMarkdown('```\nval a = 1\n  val b = 2\n```')
    expect(r).toEqual([{ k: 'code', text: 'val a = 1\n  val b = 2' }])
  })

  it('`code` and **bold** are split out of plain text', () => {
    expect(parseInline('call `delay()` is **cooperative**')).toEqual([
      { t: 'text', v: 'call ' },
      { t: 'code', v: 'delay()' },
      { t: 'text', v: ' is ' },
      { t: 'bold', v: 'cooperative' },
    ])
  })

  it('an unmatched mark does not swallow text', () => {
    // Losing text is the worst kind of broken for a page that's all text: no
    // one notices it's missing. So dangling syntax must show up verbatim.
    expect(parseInline('2 * 3 ** 4').map(d => d.v).join('')).toBe('2 * 3 ** 4')
    expect(parseInline('mark ` unmatched').map(d => d.v).join('')).toBe('mark ` unmatched')
  })

  it('no content disappears passing through the reader', () => {
    // The invariant covering every case above: every character that isn't
    // syntax markup must still be present in the output.
    const src = '## Heading\n\na **paragraph** with `syntax`.\n\n- item one\n- item `two`\n\n```\ncode\n```'
    const text = (k: ReturnType<typeof parseMarkdown>[number]): string =>
      k.k === 'code' ? k.text
        : k.k === 'ul' ? k.items.map(i => i.map(d => d.v).join('')).join(' ')
        : k.content.map(d => d.v).join('')
    const out = parseMarkdown(src).map(text).join(' ')
    for (const word of ['Heading', 'paragraph', 'syntax', 'item one', 'two', 'code']) {
      expect(out, `lost "${word}"`).toContain(word)
    }
  })
})
