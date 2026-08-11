import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LessonMeta { id: string; order: number; title: string; summary: string }

const here = dirname(fileURLToPath(import.meta.url))

export const LESSON_IDS = ['jobtree', 'normalfail', 'supervisor'] as const

export const LESSONS: LessonMeta[] = LESSON_IDS
  .map(id => JSON.parse(readFileSync(join(here, id, 'meta.json'), 'utf8')) as LessonMeta)
  .sort((a, b) => a.order - b.order)

export function loadLessonSource(id: string): string {
  return readFileSync(join(here, id, 'main.kt'), 'utf8')
}
