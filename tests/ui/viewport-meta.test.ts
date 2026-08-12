import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('mobile viewport', () => {
  it('uses the device width at 1x scale', () => {
    const html = readFileSync('index.html', 'utf8')

    expect(html).toMatch(
      /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*\/?>/,
    )
  })
})
