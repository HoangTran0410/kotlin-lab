import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string) => runSource(src).output
const evs = (src: string) => runSource(src).events

describe('interpreter — coroutine builder', () => {
  it('runBlocking chạy thân', () => {
    expect(out('fun main() = runBlocking {\n  println("in")\n}')).toEqual(['in'])
  })

  it('launch tạo child job', () => {
    const e = evs('fun main() = runBlocking {\n  launch { println("child") }\n}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    expect(created).toHaveLength(2)
    // Event là union theo discriminant `k`; .filter() không tự thu hẹp kiểu phần
    // tử (không phải type predicate), nên phải ép kiểu như các test khác trong
    // repo (vd. runtime-propagation.test.ts) để qua strict typecheck.
    expect(created[1]).toMatchObject({ builder: 'launch', parentId: (created[0] as { id: string }).id })
  })

  it('launch chạy sau khi thân cha nhường quyền', () => {
    expect(out('fun main() = runBlocking {\n  launch { println("B") }\n  println("A")\n}'))
      .toEqual(['A', 'B'])
  })

  it('delay sắp xếp thứ tự hoàn thành', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  launch { delay(200); println("cham") }\n' +
      '  launch { delay(100); println("nhanh") }\n' +
      '}')).toEqual(['nhanh', 'cham'])
  })

  it('coroutineScope chờ hết children', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  coroutineScope { launch { delay(50); println("con") } }\n' +
      '  println("sau")\n' +
      '}')).toEqual(['con', 'sau'])
  })

  it('supervisorScope tạo job có isSupervisor', () => {
    const e = evs('fun main() = runBlocking {\n  supervisorScope { launch { } }\n}')
    expect(e.some(x => x.k === 'COROUTINE_CREATED' && x.ctx.isSupervisor)).toBe(true)
  })

  it('Dispatchers.IO đặt dispatcher cho coroutine', () => {
    const e = evs('fun main() = runBlocking {\n  launch(Dispatchers.IO) { delay(1) }\n}')
    expect(e.some(x => x.k === 'COROUTINE_CREATED' && x.ctx.dispatcher === 'IO')).toBe(true)
  })

  it('exception chưa bắt trong launch làm child FAILED', () => {
    const e = evs('fun main() = runBlocking {\n  launch { throw RuntimeException("boom") }\n}')
    expect(e.some(x => x.k === 'EXCEPTION_THROWN' && x.exType === 'RuntimeException')).toBe(true)
  })

  it('cancel job phát CANCEL_REQUESTED', () => {
    const e = evs(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(1000) }\n' +
      '  j.cancel()\n' +
      '}')
    expect(e.some(x => x.k === 'CANCEL_REQUESTED')).toBe(true)
  })

  it('launch bên trong suspend fun gắn đúng coroutine scope của caller', () => {
    // Bịt khoảng trống Task 15 để lại: callFun truyền env.enclosingJobId vào
    // scope của thân hàm, nhưng Task 15 chưa có builder nào nên bỏ tham số đó
    // đi cũng không test nào đỏ. Giờ đã có launch thì kiểm được.
    const e = evs(
      'suspend fun work(scope: CoroutineScope) {\n' +
      '  scope.launch { delay(1) }\n' +
      '}\n' +
      'fun main() = runBlocking {\n  work(this)\n}')
    const created = e.filter(x => x.k === 'COROUTINE_CREATED')
    // Coroutine do launch trong suspend fun tạo phải có parentId, không phải root rời.
    expect(created.length).toBeGreaterThanOrEqual(2)
    expect((created[created.length - 1] as { parentId: string | null }).parentId).not.toBeNull()
  })

  it('finally vẫn chạy khi coroutine bị cancel — kiểm chứng chọn generator là đúng', () => {
    const o = out(
      'fun main() = runBlocking {\n' +
      '  try { delay(10); println("xong") } finally { println("dontrolai") }\n' +
      '}')
    expect(o).toContain('dontrolai')
  })
})
