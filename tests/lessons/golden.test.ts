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
    it('mọi job đều đạt trạng thái KẾT THÚC, không kẹt ở New/Completing', () => {
      // Lọc theo state === 'Active' là chưa đủ: một job kẹt ở 'New' (không bao
      // giờ được chạy) hay ở 'Completing' (không bao giờ chốt xong) đều lọt qua,
      // trong khi cả hai đều là hỏng. Khẳng định theo chiều dương.
      const w = finalWorld('jobtree')
      const states = [...w.jobs.values()].map(j => j.state)
      expect(states.length).toBeGreaterThan(0)
      expect(states.filter(s => s !== 'Completed' && s !== 'Cancelled')).toEqual([])
    })

    it('CANCEL_REQUESTED đi ĐÚNG CHIỀU: từ user xuống parent, rồi parent xuống 3 con', () => {
      // Đếm >= 3 không kiểm được chiều nào cả: ba sự kiện đi ngược lên, hay ba
      // sự kiện trùng nhau, đều thoả. Cancel đi XUỐNG là luật mà bài học này dạy.
      const e = runLesson('jobtree').events
      const created = e.filter(x => x.k === 'COROUTINE_CREATED')
      const rootId = (created[0] as { id: string }).id
      // parent là launch đầu tiên dưới root; 3 con của nó là các launch còn lại.
      const parentId = (created[1] as { id: string }).id
      const cancels = e.filter(x => x.k === 'CANCEL_REQUESTED')
        .map(x => [(x as { from: string }).from, (x as { to: string }).to])

      expect(cancels[0]).toEqual(['user', parentId])
      const fromParent = cancels.filter(([from]) => from === parentId).map(([, to]) => to)
      expect(fromParent).toHaveLength(3)
      // Đúng 3 con phân biệt, và không sự kiện nào trỏ ngược lên root.
      expect(new Set(fromParent).size).toBe(3)
      expect(cancels.some(([, to]) => to === rootId)).toBe(false)
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
