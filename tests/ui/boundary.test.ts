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

describe('ranh giới kiến trúc — ép bằng lint thật, không đọc config', () => {
  it('src/ui không được import node:fs', () => {
    expect(lint("import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n",
      'src/ui/bad.ts')).toContain('không có Node API')
  })

  it('src/state không được import lessons/index', () => {
    expect(lint("import { LESSONS } from '../lessons/index'\nexport const x = LESSONS\n",
      'src/state/bad.ts')).toContain('browser-safe')
  })

  it('src/engine vẫn không được import react — ranh giới M1 chưa bị nới', () => {
    expect(lint("import { useState } from 'react'\nexport const x = useState\n",
      'src/engine/bad.ts')).toContain('thuần TypeScript')
  })

  it('src/ui ĐƯỢC PHÉP import react — rule không bắt nhầm', () => {
    expect(lint("import { useState } from 'react'\nexport const x = useState\n",
      'src/ui/ok.tsx')).not.toContain('thuần TypeScript')
  })
})
