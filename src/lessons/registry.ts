export interface LessonMeta {
  id: string; order: number; title: string; summary: string
  /** Concepts this lesson teaches — shown as chips on the lesson card. */
  concepts: string[]
}

/**
 * Browser-side parallel of `lessons/index.ts`.
 *
 * `index.ts` uses `node:fs`, so Vite can't bundle it. We don't fix it in place
 * because M1's golden test (`tests/lessons/golden.test.ts`) runs in a Node
 * environment and relies on it. Two files, two environments, one data source: the
 * same `.kt`/`.json` files. This task has a test asserting the two versions do NOT
 * drift apart.
 *
 * `eager: true` because the total size is a few KB and we want the lesson list
 * present in sync at first render, not after a promise resolves.
 */
const sources = import.meta.glob<string>('./*/main.kt', { query: '?raw', import: 'default', eager: true })
const metas = import.meta.glob<LessonMeta>('./*/meta.json', { import: 'default', eager: true })

/**
 * Which lessons have been compared line by line with real JVM output — derived
 * from the PRESENCE of a fixture, not from a hand-written list. The about page
 * shows this count, and it must stay correct automatically whenever someone adds
 * or removes a fixture.
 */
const fixtures = import.meta.glob('./*/expected-jvm-output.txt', { query: '?raw', eager: true })

/** Each lesson's mental model — the prose you read BEFORE hitting run. */
const models = import.meta.glob<string>(
  './*/mental-model.md', { query: '?raw', import: 'default', eager: true })

const idFrom = (path: string): string => path.split('/')[1] ?? ''

export const LESSON_LIST: LessonMeta[] = Object.values(metas).sort((a, b) => a.order - b.order)

const byId = new Map<string, string>(
  Object.entries(sources).map(([path, src]) => [idFrom(path), src]),
)

export function lessonSource(id: string): string | null {
  return byId.get(id) ?? null
}

export const LESSON_IDS_WITH_JVM_FIXTURE: ReadonlySet<string> = new Set(
  Object.keys(fixtures).map(idFrom),
)

const modelById = new Map<string, string>(
  Object.entries(models).map(([path, src]) => [idFrom(path), src]),
)

export function lessonMentalModel(id: string): string | null {
  return modelById.get(id) ?? null
}
