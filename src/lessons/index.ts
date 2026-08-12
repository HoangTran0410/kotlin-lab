import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LessonMeta {
  id: string; order: number; title: string; summary: string; concepts: string[]
}

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Derived from the DIRECTORY, not from a hand-written array.
 *
 * The hard-coded list used to be copied out to four places (this file plus
 * three test files), so adding a lesson meant remembering to fix all four — and
 * whichever one got missed left the new lesson silently untested. The browser
 * version (`registry.ts`) already discovers lessons automatically via
 * `import.meta.glob`; now both paths derive from the same source.
 */
export const LESSONS: LessonMeta[] = readdirSync(here, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => JSON.parse(readFileSync(join(here, d.name, 'meta.json'), 'utf8')) as LessonMeta)
  .sort((a, b) => a.order - b.order)

export const LESSON_IDS: string[] = LESSONS.map(l => l.id)

export function loadLessonSource(id: string): string {
  return readFileSync(join(here, id, 'main.kt'), 'utf8')
}
