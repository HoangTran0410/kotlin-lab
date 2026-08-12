import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LessonMeta {
  id: string; order: number; title: string; summary: string; concepts: string[]
}

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Suy từ THƯ MỤC, không phải từ một mảng viết tay.
 *
 * Danh sách cứng trước đây bị chép ra bốn chỗ (file này + ba file test), nên
 * thêm một bài là phải nhớ sửa cả bốn — và quên chỗ nào thì bài mới lặng lẽ
 * không được kiểm. Bản browser (`registry.ts`) vốn đã tự phát hiện qua
 * `import.meta.glob`; giờ hai đường cùng suy từ một nguồn.
 */
export const LESSONS: LessonMeta[] = readdirSync(here, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => JSON.parse(readFileSync(join(here, d.name, 'meta.json'), 'utf8')) as LessonMeta)
  .sort((a, b) => a.order - b.order)

export const LESSON_IDS: string[] = LESSONS.map(l => l.id)

export function loadLessonSource(id: string): string {
  return readFileSync(join(here, id, 'main.kt'), 'utf8')
}
