import { describe, expect, it } from 'vitest'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { LESSONS, loadLessonSource } from '../../src/lessons'

describe('registry lesson — bản browser khớp bản Node', () => {
  it('cùng danh sách id, cùng thứ tự', () => {
    expect(LESSON_LIST.map(l => l.id)).toEqual(LESSONS.map(l => l.id))
  })

  it('cùng metadata từng bài', () => {
    expect(LESSON_LIST).toEqual(LESSONS)
  })

  it('cùng nội dung nguồn từng bài — byte-for-byte', () => {
    for (const l of LESSONS) expect(lessonSource(l.id), l.id).toBe(loadLessonSource(l.id))
  })

  it('id không tồn tại trả null, không ném', () => {
    expect(lessonSource('khong-co')).toBeNull()
  })

  it('có đủ 9 lesson', () => {
    expect(LESSON_LIST).toHaveLength(9)
  })
})
