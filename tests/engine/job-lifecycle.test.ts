import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

describe('vòng đời Job — Active ngay khi tạo (CoroutineStart.DEFAULT)', () => {
  it('job Active ngay sau launch, trước khi thân nó chạy dòng nào', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(10) }
    println(job.isActive)
    println(job.isCompleted)
    println(job.isCancelled)
    job.join()
    println(job.isActive)
    println(job.isCompleted)
}`)
    expect(r.output).toEqual(['true', 'false', 'false', 'false', 'true'])
  })

  it('async cũng vậy', () => {
    const r = runSource(`fun main() = runBlocking {
    val d = async { delay(10); 1 }
    println(d.isActive)
    d.await()
    println(d.isActive)
}`)
    expect(r.output).toEqual(['true', 'false'])
  })

  it('JOB_STATE New->Active đứng NGAY SAU COROUTINE_CREATED của cùng job', () => {
    // Khẳng định về hình dạng trace, không chỉ về giá trị đọc được: nếu ai đó
    // cài bằng cách cho `isActive` nói dối (trả true khi state là New) thì hai
    // ca trên vẫn xanh còn ca này đỏ.
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const i = r.events.findIndex(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')
    const kế = r.events[i + 1]!
    expect(kế.k).toBe('JOB_STATE')
    expect(kế).toMatchObject({ from: 'New', to: 'Active' })
  })

  it('COROUTINE_STARTED vẫn phát MUỘN HƠN, ở lần chạy đầu — Active khác với đã chạy', () => {
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const active = r.events.findIndex(e => e.k === 'JOB_STATE' && e.to === 'Active' && e.id !== 'j1')
    const started = r.events.findIndex(e => e.k === 'COROUTINE_STARTED' && e.id !== 'j1')
    expect(active).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(active)
  })

  it('không có JOB_STATE nào chuyển sang Active HAI LẦN cho cùng một job', () => {
    // Canh đúng lỗi dễ mắc nhất khi sửa: thêm chuyển đổi lúc tạo mà quên bỏ
    // chuyển đổi cũ trong step().
    const r = runSource(`fun main() = runBlocking {
    launch { delay(10) }
    launch { delay(20) }
    delay(50)
}`)
    const đếm = new Map<string, number>()
    for (const e of r.events) {
      if (e.k === 'JOB_STATE' && e.to === 'Active') đếm.set(e.id, (đếm.get(e.id) ?? 0) + 1)
    }
    for (const [id, n] of đếm) expect(n, `job ${id} vào Active ${n} lần`).toBe(1)
  })

  it('huỷ một job CHƯA từng chạy vẫn đúng: Cancelled, không kẹt ở New', () => {
    const r = runSource(`fun main() = runBlocking {
    val job = launch { delay(1000); println("không in") }
    job.cancel()
    println(job.isCancelled)
    delay(50)
}`)
    expect(r.output).toEqual(['true'])
  })
})
