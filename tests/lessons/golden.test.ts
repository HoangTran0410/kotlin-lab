import { describe, expect, it } from 'vitest'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'
import { foldTrace } from '../../src/engine/trace/world'

const runLesson = (id: string) => runSource(loadLessonSource(id))
const finalWorld = (id: string) => {
  const r = runLesson(id)
  return foldTrace(r.events, r.events.length)
}

describe('lesson — nghiệm thu M1', () => {
  it('cả ba lesson parse và validate sạch', () => {
    for (const l of LESSONS) {
      expect(runLesson(l.id).diagnostics, `lesson ${l.id}`).toEqual([])
    }
  })

  it('LESSONS xếp theo order', () => {
    expect(LESSONS.map(l => l.id)).toEqual(['jobtree', 'normalfail', 'supervisor'])
  })

  describe('jobtree — cancel đi xuống', () => {
    it('mọi job đều kết thúc, không còn Active', () => {
      const w = finalWorld('jobtree')
      expect([...w.jobs.values()].filter(j => j.state === 'Active')).toEqual([])
    })

    it('có ít nhất 3 CANCEL_REQUESTED xuống các child', () => {
      const e = runLesson('jobtree').events.filter(x => x.k === 'CANCEL_REQUESTED')
      expect(e.length).toBeGreaterThanOrEqual(3)
    })

    it('không job nào in ra gì — bị cancel trước khi delay xong', () => {
      expect(runLesson('jobtree').output).toEqual([])
    })
  })

  describe('normalfail — failure kéo sibling xuống', () => {
    it('phát FAILURE_PROPAGATED không bị supervisor chặn', () => {
      const e = runLesson('normalfail').events
        .filter(x => x.k === 'FAILURE_PROPAGATED')
      expect(e.length).toBeGreaterThan(0)
      expect(e.every(x => x.blockedBySupervisor === false)).toBe(true)
    })

    it('A và C KHÔNG in ra — bị cancel theo', () => {
      expect(runLesson('normalfail').output).toEqual([])
    })

    it('có EXCEPTION_THROWN kiểu RuntimeException', () => {
      expect(runLesson('normalfail').events
        .some(x => x.k === 'EXCEPTION_THROWN' && x.exType === 'RuntimeException')).toBe(true)
    })
  })

  describe('supervisor — sibling sống tiếp', () => {
    it('phát FAILURE_PROPAGATED bị supervisor chặn', () => {
      expect(runLesson('supervisor').events
        .some(x => x.k === 'FAILURE_PROPAGATED' && x.blockedBySupervisor === true)).toBe(true)
    })

    it('A và C VẪN in ra — đây là khác biệt cốt lõi với normalfail', () => {
      expect(runLesson('supervisor').output).toEqual(['A xong', 'C xong'])
    })
  })

  it('cùng source cho trace y hệt qua nhiều lần chạy — deterministic', () => {
    for (const l of LESSONS) {
      const a = JSON.stringify(runLesson(l.id).events)
      const b = JSON.stringify(runLesson(l.id).events)
      expect(a, `lesson ${l.id}`).toBe(b)
    }
  })

  it('fold tại mọi step không ném lỗi', () => {
    for (const l of LESSONS) {
      const evts = runLesson(l.id).events
      for (let n = 0; n <= evts.length; n++) {
        expect(() => foldTrace(evts, n)).not.toThrow()
      }
    }
  })
})
