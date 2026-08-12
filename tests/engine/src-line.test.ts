import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'
import { LESSONS, loadLessonSource } from '../../src/lessons'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'
import { foldTrace } from '../../src/engine/trace/world'

/**
 * Con trỏ dòng trong editor phải ĐI THEO luồng chạy.
 *
 * Đo được trước khi sửa: chỉ 16-21% event mang `srcLine`, và có đoạn 16 event
 * liên tiếp không đổi dòng — người dùng kéo timeline thấy con trỏ đứng chết và
 * tưởng công cụ treo.
 */
describe('srcLine — dòng đi theo luồng chạy', () => {
  it('COROUTINE_STARTED trỏ vào dòng ĐẦU của thân coroutine, không phải dòng viết launch', () => {
    //  1 import
    //  2 (trống)
    //  3 fun main() = runBlocking {
    //  4     launch {
    //  5         println("trong than")
    //  6     }
    //  7     delay(50)
    //  8 }
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch {
        println("trong than")
    }
    delay(50)
}`)
    const tao = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    const taoId = tao.k === 'COROUTINE_CREATED' ? tao.id : ''
    const chay = r.events.find(e => e.k === 'COROUTINE_STARTED' && e.id === taoId)!
    expect(tao.srcLine, 'CREATED phải trỏ vào dòng viết launch').toBe(4)
    expect(chay.srcLine, 'STARTED phải trỏ vào dòng đầu của THÂN').toBe(5)
  })

  it('COROUTINE_RESUMED trỏ vào đúng điểm suspend mà nó đang treo', () => {
    //  4     launch {
    //  5         delay(100)
    //  6         println("sau delay")
    //  7     }
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    launch {
        delay(100)
        println("sau delay")
    }
    delay(200)
}`)
    const con = r.events.find(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')!
    const conId = con.k === 'COROUTINE_CREATED' ? con.id : ''
    const treo = r.events.find(e => e.k === 'COROUTINE_SUSPENDED' && e.id === conId)!
    const tiep = r.events.find(e => e.k === 'COROUTINE_RESUMED' && e.id === conId)!
    expect(treo.srcLine).toBe(5)
    expect(tiep.srcLine, 'RESUMED phải trỏ về chính chỗ đã treo').toBe(5)
  })

  it('event huỷ trỏ vào chỗ NẠN NHÂN đang đứng, không phải dòng throw', () => {
    //  5         launch { delay(500); println("A") }     <- nạn nhân treo ở đây
    //  6         launch { delay(50); throw RuntimeException("boom") }
    const r = runSource(`import kotlinx.coroutines.*

fun main() = runBlocking {
    coroutineScope {
        launch { delay(500); println("A") }
        launch { delay(50); throw RuntimeException("boom") }
    }
}`)
    const tao = r.events.filter(e => e.k === 'COROUTINE_CREATED' && e.builder === 'launch')
    const dau = tao[0]!
    const nanNhan = dau.k === 'COROUTINE_CREATED' ? dau.id : ''
    const nem = r.events.find(e => e.k === 'EXCEPTION_THROWN')!
    expect(nem.srcLine, 'throw ở dòng 6').toBe(6)

    const huy = r.events.find(e => e.k === 'JOB_STATE' && e.id === nanNhan && e.to === 'Cancelled')!
    expect(huy.srcLine, 'nạn nhân đang treo ở delay dòng 5 khi bị giết').toBe(5)
    expect(huy.srcLine).not.toBe(nem.srcLine)
  })

  it('mọi lesson: dòng đổi ở ít nhất 1/4 số mốc, và không đứng im quá 10 mốc liền', () => {
    // Đây là phép đo GẦN NHẤT với trải nghiệm thật: người học bấm nút tua theo
    // MỐC (xem GraphStage), không kéo từng event. Ngưỡng đặt dưới mức đo được
    // hiện tại (thấp nhất 28%, đứng im dài nhất 10) để không đỏ vì dao động
    // nhỏ, nhưng vẫn đỏ nếu ai đó gỡ việc gắn dòng đi.
    for (const l of LESSONS) {
      const ev = runSource(loadLessonSource(l.id)).events
      const moc = narrateTrace(ev)
      let doi = 0, truoc: number | null = null, imMax = 0, im = 0
      for (const m of moc) {
        const line = foldTrace(ev, m.index + 1).srcLine
        if (line !== truoc) { doi++; truoc = line ?? null; im = 1 } else { im++; imMax = Math.max(imMax, im) }
      }
      expect(doi / moc.length, `${l.id}: dòng gần như không đổi khi tua`).toBeGreaterThan(0.25)
      expect(imMax, `${l.id}: có đoạn dài con trỏ đứng im`).toBeLessThanOrEqual(10)
    }
  })
})
