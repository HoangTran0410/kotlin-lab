/**
 * Lấy output THẬT của từng lesson khi chạy trên JVM, ghi thành fixture.
 *
 * Chạy TAY (`npm run jvm:fetch [id...]`), không nằm trong `npm test` — bộ test
 * chỉ đọc fixture đã commit nên chạy offline được. Không truyền id thì lấy hết.
 *
 * Vì sao có script này thay vì một dòng curl chép đi chép lại: hai chốt an
 * toàn phải chạy MỖI LẦN, và người ta luôn quên chúng khi gõ tay.
 *   1. `errors` có ERROR -> NÉM, không ghi file. Lesson không biên dịch được
 *      trên Kotlin thật là bug của lesson, không phải thứ để ghi lại rồi đi tiếp.
 *   2. `exception` khác null -> NÉM. Chương trình có exception không bắt thì
 *      sandbox playground giết tiến trình ở một thời điểm KHÔNG lặp lại được
 *      (đo được: cùng một hình dạng chương trình, lúc ra 1 dòng lúc ra 2 dòng).
 *      Ghi số đo đó thành fixture là đóng băng sự bất định của sandbox chứ
 *      không phải ngữ nghĩa Kotlin — xem danh sách miễn trừ trong
 *      tests/lessons/jvm-parity.test.ts.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LESSONS, loadLessonSource } from '../src/lessons/index'

const API = 'https://api.kotlinlang.org/api/2.1.20/compiler/run'

interface KotlinError { severity: string; message: string; interval?: unknown }
interface RunResponse {
  errors?: Record<string, KotlinError[]>
  exception?: { message?: string; fullName?: string } | null
  text?: string
}

/** stdout nằm trong thẻ `<outStream>` của trường `text`. */
function outStream(text: string): string {
  const parts = [...text.matchAll(/<outStream>([\s\S]*?)<\/outStream>/g)]
  return parts.map(m => m[1] ?? '').join('')
}

async function fetchOne(id: string): Promise<void> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://play.kotlinlang.org' },
    body: JSON.stringify({
      args: '',
      files: [{ name: 'File.kt', publicId: '', text: loadLessonSource(id) }],
      confType: 'java',
    }),
  })
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`)
  const data = await res.json() as RunResponse

  const errors = (data.errors?.['File.kt'] ?? []).filter(e => e.severity === 'ERROR')
  if (errors.length > 0) {
    throw new Error(`${id}: KHÔNG biên dịch được trên Kotlin thật:\n`
      + errors.map(e => `  - ${e.message}`).join('\n'))
  }
  if (data.exception) {
    throw new Error(`${id}: chương trình ném exception không bắt `
      + `(${data.exception.fullName ?? ''}: ${data.exception.message ?? ''}). `
      + 'Sandbox playground giết tiến trình không lặp lại được — không ghi fixture. '
      + 'Thêm bài này vào KHONG_CO_FIXTURE trong tests/lessons/jvm-parity.test.ts.')
  }

  const out = outStream(data.text ?? '')
  const path = join('src/lessons', id, 'expected-jvm-output.txt')
  writeFileSync(path, out.endsWith('\n') || out === '' ? out : `${out}\n`)
  console.log(`${id}: ${out.split('\n').filter(l => l !== '').length} dòng -> ${path}`)
}

const ids = process.argv.slice(2)
const chon = ids.length > 0 ? ids : LESSONS.map(l => l.id)
for (const id of chon) {
  // Tuần tự + nghỉ 1 giây: API công cộng, đừng bắn song song 13 phát.
  await fetchOne(id)
  await new Promise(r => setTimeout(r, 1000))
}
