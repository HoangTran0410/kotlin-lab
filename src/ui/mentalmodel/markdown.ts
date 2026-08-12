/**
 * A minimal Markdown reader, exactly matching the syntax subset that
 * `mental-model.md` uses: `## heading`, paragraphs, `- ` lists, ``` code
 * blocks, and inline `**bold**` with `` `code` ``.
 *
 * Why not pull in a markdown library: this whole reader fits in one file
 * that's readable in a minute, and it returns DATA for React to build
 * elements from — no raw HTML is ever generated, so there's also no path for
 * lesson content to inject a tag into the page. A full markdown library
 * brings along both `dangerouslySetInnerHTML` and the need to sanitize HTML,
 * in exchange for dozens of syntax forms that nothing here ever uses.
 *
 * Syntax it doesn't recognize falls through to a plain paragraph — shown
 * verbatim, not dropped. Losing text is the worst kind of broken for a page
 * that's all text.
 */

export type InlineSpan =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }

export type MdBlock =
  | { k: 'h'; content: InlineSpan[] }
  | { k: 'p'; content: InlineSpan[] }
  | { k: 'ul'; items: InlineSpan[][] }
  | { k: 'code'; text: string }

/** Splits `**bold**` and `` `code` `` out of plain text. Unmatched marks are kept verbatim. */
export function parseInline(s: string): InlineSpan[] {
  const out: InlineSpan[] = []
  let i = 0
  let buf = ''
  const flush = (): void => { if (buf !== '') { out.push({ t: 'text', v: buf }); buf = '' } }

  while (i < s.length) {
    if (s.startsWith('**', i)) {
      const end = s.indexOf('**', i + 2)
      if (end > i + 2) { flush(); out.push({ t: 'bold', v: s.slice(i + 2, end) }); i = end + 2; continue }
    }
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, end) }); i = end + 1; continue }
    }
    buf += s[i]
    i++
  }
  flush()
  return out
}

export function parseMarkdown(src: string): MdBlock[] {
  const out: MdBlock[] = []
  const lines = src.split('\n')
  let para: string[] = []
  let list: string[] | null = null

  const flushPara = (): void => {
    if (para.length > 0) { out.push({ k: 'p', content: parseInline(para.join(' ')) }); para = [] }
  }
  const flushList = (): void => {
    if (list !== null) { out.push({ k: 'ul', items: list.map(parseInline) }); list = null }
  }
  const flush = (): void => { flushPara(); flushList() }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (l.startsWith('```')) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) { body.push(lines[i]!); i++ }
      out.push({ k: 'code', text: body.join('\n') })
      continue
    }
    if (l.trim() === '') { flush(); continue }
    if (l.startsWith('## ')) { flush(); out.push({ k: 'h', content: parseInline(l.slice(3).trim()) }); continue }
    if (l.startsWith('- ')) {
      flushPara()
      list ??= []
      list.push(l.slice(2).trim())
      continue
    }
    // A line indented right under a list item is the CONTINUATION of that
    // item, not a new paragraph. Drop this rule and any two-line list item
    // gets cut in half, with the second half falling out of the list.
    if (list !== null && l.startsWith('  ')) { list[list.length - 1] += ` ${l.trim()}`; continue }
    flushList()
    para.push(l.trim())
  }
  flush()
  return out
}
