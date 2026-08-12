import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { jobLabel } from '../../src/engine/trace/label'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'

const taoRa = (src: string) =>
  runSource(src).events.filter(e => e.k === 'COROUTINE_CREATED')

describe('nhãn node — gọi coroutine bằng đúng tên người học đã gõ', () => {
  it('thứ tự ưu tiên: CoroutineName > tên biến > builder', () => {
    expect(jobLabel({ id: 'j1', builder: 'launch', name: 'worker', varName: 'job' })).toBe('worker')
    expect(jobLabel({ id: 'j1', builder: 'launch', name: null, varName: 'job' })).toBe('job')
    expect(jobLabel({ id: 'j1', builder: 'launch', name: null, varName: null })).toBe('launch')
  })

  it('`val job = launch { }` gắn tên biến vào node', () => {
    const t = taoRa(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val nguoiDoc = launch { delay(10) }
    nguoiDoc.join()
}`)
    const con = t.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    expect(con.k === 'COROUTINE_CREATED' && con.varName).toBe('nguoiDoc')
  })

  it('async và CoroutineScope cũng lấy được tên biến', () => {
    const t = taoRa(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val pham = CoroutineScope(SupervisorJob())
    val ketQua = pham.async { 1 }
    delay(10)
    pham.cancel()
}`)
    const ten = t.map(e => (e.k === 'COROUTINE_CREATED' ? e.varName ?? null : null))
    expect(ten).toContain('pham')
    expect(ten).toContain('ketQua')
  })

  it('CoroutineName THẮNG tên biến — cái người học cố ý gõ ra thì được ưu tiên', () => {
    const t = taoRa(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val bien = launch(CoroutineName("thoMay")) { delay(10) }
    bien.join()
}`)
    const con = t.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    if (con.k !== 'COROUTINE_CREATED') throw new Error('sai kind')
    // Cả hai đều có mặt trong dữ liệu — ưu tiên là việc của jobLabel, không
    // phải bằng cách vứt bớt thông tin ở tầng engine.
    expect(con.varName).toBe('bien')
    expect(con.ctx.name).toBe('thoMay')
    expect(jobLabel({ id: con.id, builder: con.builder, name: con.ctx.name, varName: con.varName }))
      .toBe('thoMay')
  })

  it('launch KHÔNG gán vào biến thì không có varName', () => {
    const t = taoRa(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch { delay(10) }
    delay(50)
}`)
    const con = t.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    expect(con.k === 'COROUTINE_CREATED' && con.varName).toBeUndefined()
  })

  it('tên biến KHÔNG rò sang coroutine sinh ra BÊN TRONG lời gọi ở vế phải', () => {
    // Chỗ dễ sai nhất của cách cài: nếu chỉ nhớ "tên biến đang chờ" rồi dán cho
    // spawn KẾ TIẾP, thì coroutine sinh ra bên trong `taoViec()` — chạy TRONG
    // lúc đánh giá vế phải — sẽ cướp mất tên `ketQua`.
    //
    // Hàm ở đây BẮT BUỘC phải thật sự spawn. Bản đầu của test này gọi một hàm
    // không spawn gì, nên gỡ hẳn phép kiểm cú pháp ra nó vẫn xanh — canh gác
    // rỗng. Đã đo lại: với hàm có spawn thì nó đỏ đúng như phải thế.
    const r = runSource(`import kotlinx.coroutines.*

suspend fun taoViec(): Int {
    coroutineScope {
        launch { delay(1) }
    }
    return 1
}

fun main() = runBlocking {
    val ketQua = taoViec()
    println(ketQua)
}`)
    expect(r.diagnostics).toEqual([])
    const cacCon = r.events.filter(e => e.k === 'COROUTINE_CREATED')
    for (const c of cacCon) {
      expect(c.k === 'COROUTINE_CREATED' && c.varName,
        `${c.k === 'COROUTINE_CREATED' ? c.builder : '?'} bên trong taoViec() lại mang tên biến của người gọi`)
        .toBeUndefined()
    }
    expect(r.output).toEqual(['1'])
  })

  it('tên biến không bị coroutine sinh ra khi ĐÁNH GIÁ ĐỐI SỐ cướp mất', () => {
    // `launch(donDep())` — `donDep()` chạy TRƯỚC khi launch spawn, và nó tự
    // spawn. Nếu tên biến không được lấy-và-xoá trước lúc đánh giá đối số thì
    // coroutine bên trong `donDep()` sẽ nhận nhãn `chinh`.
    const r = runSource(`import kotlinx.coroutines.*

suspend fun donDep(): Int {
    coroutineScope {
        launch { delay(1) }
    }
    return 1
}

fun main() = runBlocking {
    val chinh = launch(donDep()) { delay(10) }
    chinh.join()
}`)
    expect(r.diagnostics).toEqual([])
    const mangTen = r.events.filter(
      e => e.k === 'COROUTINE_CREATED' && e.varName === 'chinh')
    expect(mangTen, 'đúng MỘT coroutine được mang tên `chinh`').toHaveLength(1)
    // Và nó phải là cái CHẠY 10ms, không phải cái dọn dẹp bên trong donDep().
    const dung = mangTen[0]!
    expect(dung.k === 'COROUTINE_CREATED' && dung.builder).toBe('launch')
    const conCuaDonDep = r.events.filter(
      e => e.k === 'COROUTINE_CREATED' && e.parentId !== null
        && r.events.some(p => p.k === 'COROUTINE_CREATED' && p.id === e.parentId
          && p.builder === 'coroutineScope'))
    for (const c of conCuaDonDep) {
      expect(c.k === 'COROUTINE_CREATED' && c.varName,
        'coroutine bên trong donDep() cướp mất tên biến của người gọi').toBeUndefined()
    }
  })

  it('diễn giải gọi coroutine bằng đúng tên biến đó', () => {
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    val thoIn = launch { println("xin chao") }
    thoIn.join()
}`)
    const cau = narrateTrace(r.events).map(l => l.text)
    expect(cau.some(c => c.includes('thoIn')), 'không câu nào gọi tên biến').toBe(true)
    // Và KHÔNG còn gọi nó bằng "launch j2" nữa.
    expect(cau.some(c => c.includes('`launch`'))).toBe(false)
  })
})
