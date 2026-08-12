import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

function lint(code: string, asPath: string): string {
  try {
    execFileSync('npx', ['eslint', '--stdin', '--stdin-filename', asPath, '-f', 'json'],
      { input: code, encoding: 'utf8' })
    return ''
  } catch (e) {
    const err = e as { stdout?: string }
    return err.stdout ?? ''
  }
}

describe('architecture boundary — enforced by real lint output, not by reading config', () => {
  it('src/ui must not import node:fs', () => {
    expect(lint("import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n",
      'src/ui/bad.ts')).toContain('no Node API')
  })

  it('src/state must not import lessons/index', () => {
    expect(lint("import { LESSONS } from '../lessons/index'\nexport const x = LESSONS\n",
      'src/state/bad.ts')).toContain('browser-safe')
  })

  it('src/engine still must not import react — the M1 boundary has not been relaxed', () => {
    expect(lint("import { useState } from 'react'\nexport const x = useState\n",
      'src/engine/bad.ts')).toContain('pure TypeScript')
  })

  it('src/ui IS ALLOWED to import react — the rule does not misfire', () => {
    expect(lint("import { useState } from 'react'\nexport const x = useState\n",
      'src/ui/ok.tsx')).not.toContain('pure TypeScript')
  })
})
