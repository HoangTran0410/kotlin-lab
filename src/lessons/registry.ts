export interface LessonMeta { id: string; order: number; title: string; summary: string }

/**
 * Bản song song của `lessons/index.ts` dành cho browser.
 *
 * `index.ts` dùng `node:fs` nên Vite không bundle được. Không sửa tại chỗ vì
 * golden test của M1 (`tests/lessons/golden.test.ts`) chạy ở môi trường Node và
 * đang dựa vào nó. Hai file, hai môi trường, một nguồn dữ liệu: cùng những file
 * `.kt`/`.json` đó. Task này có test khẳng định hai bản KHÔNG trôi lệch nhau.
 *
 * `eager: true` vì tổng dung lượng vài KB và ta muốn danh sách lesson có mặt
 * đồng bộ lúc render đầu tiên, không phải sau một promise.
 */
const sources = import.meta.glob<string>('./*/main.kt', { query: '?raw', import: 'default', eager: true })
const metas = import.meta.glob<LessonMeta>('./*/meta.json', { import: 'default', eager: true })

/**
 * Bài nào đã được so từng dòng với output JVM thật — suy từ sự CÓ MẶT của
 * fixture, không phải từ một danh sách viết tay. Trang giới thiệu hiện con số
 * này, và nó phải tự đúng khi ai đó thêm hoặc rút một fixture.
 */
const fixtures = import.meta.glob('./*/expected-jvm-output.txt', { query: '?raw', eager: true })

/** Mô hình tư duy của từng bài — phần chữ đọc TRƯỚC khi bấm chạy. */
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

export const LESSON_IDS_DOI_CHIEU_JVM: ReadonlySet<string> = new Set(
  Object.keys(fixtures).map(idFrom),
)

const modelById = new Map<string, string>(
  Object.entries(models).map(([path, src]) => [idFrom(path), src]),
)

export function lessonMentalModel(id: string): string | null {
  return modelById.get(id) ?? null
}
