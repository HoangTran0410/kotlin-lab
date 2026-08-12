import { describe, expect, it } from 'vitest'
import { loadLessonSource } from '../../src/lessons'
import { runSource } from '../../src/engine/run'
import type { Event } from '../../src/engine/trace/events'

/**
 * Mỗi bài mới được neo bằng ĐÚNG cái nó dạy, không chỉ bằng output.
 *
 * Output đã được `jvm-parity.test.ts` so từng dòng với JVM thật, nên chép lại
 * ở đây là thừa. Cái output KHÔNG chứng minh được là *vì sao*: bốn bài này đều
 * có thể in ra đúng chừng ấy dòng vì một lý do sai (job không có cha lại hoá ra
 * có, cancelAndJoin hoá ra không chờ, async chạy tuần tự mà vẫn ra cùng tổng).
 * Những ca dưới đây nhắm vào chỗ đó.
 */
const chay = (id: string) => runSource(loadLessonSource(id))
const inRa = (e: Event, s: string): boolean => e.k === 'PRINTLN' && e.text.startsWith(s)
const viTri = (evts: Event[], s: string): number => evts.findIndex(e => inRa(e, s))

describe('cleanup — huỷ và dọn dẹp', () => {
  it('finally chạy SAU khi lệnh huỷ tới, không phải trước', () => {
    const e = chay('cleanup').events
    const huy = e.findIndex(x => x.k === 'CANCEL_REQUESTED')
    expect(huy).toBeGreaterThanOrEqual(0)
    expect(viTri(e, '3. finally')).toBeGreaterThan(huy)
  })

  it('cancelAndJoin() CHỜ finally xong mới trả về', () => {
    // Đây là toàn bộ khác biệt giữa `cancel()` và `cancelAndJoin()`. Nếu ai đó
    // nối cancelAndJoin thẳng vào cancel (đúng lỗi từng có trong interpreter),
    // dòng 4 sẽ nhảy lên trước dòng 3 và ca này đỏ.
    const e = chay('cleanup').events
    expect(viTri(e, '4. cancelAndJoin')).toBeGreaterThan(viTri(e, '3. finally'))
  })

  it('job kết thúc ở Cancelled, không phải Completed', () => {
    const e = chay('cleanup').events
    const con = e.find(x => x.k === 'COROUTINE_CREATED' && x.varName === 'job')!
    const id = (con as { id: string }).id
    const cuoi = e.filter(x => x.k === 'JOB_STATE' && x.id === id).at(-1)
    expect(cuoi).toMatchObject({ to: 'Cancelled' })
  })
})

describe('swallow — catch rộng nuốt mất tín hiệu huỷ', () => {
  it('phát EXCEPTION_CAUGHT đúng kiểu CancellationException', () => {
    const bat = chay('swallow').events.filter(e => e.k === 'EXCEPTION_CAUGHT')
    expect(bat).toHaveLength(1)
    expect(bat[0]).toMatchObject({ exType: 'CancellationException' })
  })

  it('thân chạy TIẾP sau khi nuốt — và Job thì vẫn Cancelled', () => {
    // Hai vế phải cùng đúng mới ra được bài học. Chỉ kiểm vế đầu thì một engine
    // bỏ qua cancel hoàn toàn cũng xanh; chỉ kiểm vế sau thì một engine giết
    // thẳng coroutine tại chỗ huỷ cũng xanh.
    const r = chay('swallow')
    const con = r.events.find(x => x.k === 'COROUTINE_CREATED' && x.varName === 'job')!
    const id = (con as { id: string }).id
    expect(viTri(r.events, '3. thân vẫn chạy tiếp')).toBeGreaterThan(0)
    const cuoi = r.events.filter(x => x.k === 'JOB_STATE' && x.id === id).at(-1)
    expect(cuoi).toMatchObject({ to: 'Cancelled' })
    expect(r.output.at(-1)).toBe('4. job.isCancelled = true')
  })
})

describe('parallel — tuần tự hay song song, đồng hồ mới nói thật', () => {
  it('hai lời gọi tuần tự tốn 200+200, hai async chỉ tốn 200', () => {
    // Output của hai nửa giống hệt nhau (đều ra 5) — CHỈ có đồng hồ ảo phân
    // biệt được. Nếu async bị cài thành chạy-ngay-tại-chỗ thì nửa sau cũng
    // thành 400 và ca này đỏ.
    const e = chay('parallel').events
    const t = (s: string): number => e[viTri(e, s)]!.t
    expect(t('2. tuần tự xong') - t('1. tuần tự')).toBe(400)
    expect(t('4. song song xong') - t('3. song song')).toBe(200)
  })

  it('hai async là hai job con thật, tạo ra TRƯỚC khi await cái nào', () => {
    const e = chay('parallel').events
    const async2 = e.filter(x => x.k === 'COROUTINE_CREATED' && x.builder === 'async')
    expect(async2).toHaveLength(2)
    expect(async2.map(x => (x as { varName?: string }).varName)).toEqual(['anh', 'ten'])
    const await1 = e.findIndex(x => x.k === 'COROUTINE_SUSPENDED' && x.reason === 'await')
    expect(await1).toBeGreaterThan(e.indexOf(async2[1]!))
  })
})

describe('globalscope — coroutine không có cha', () => {
  it('job của GlobalScope có parentId null, job kia treo dưới root', () => {
    const e = chay('globalscope').events
    const tao = e.filter(x => x.k === 'COROUTINE_CREATED')
    const root = tao[0] as { id: string }
    const con = tao.filter(x => (x as { builder: string }).builder === 'launch')
    expect(con).toHaveLength(2)
    expect((con[0] as { parentId: string | null }).parentId).toBe(root.id)
    expect((con[1] as { parentId: string | null }).parentId).toBeNull()
  })

  it('không ai chờ nó: chương trình kết thúc trong khi nó còn đang delay', () => {
    // Khẳng định theo chiều dương — "output không có dòng đó" cũng xanh nếu
    // coroutine kia chưa từng được tạo. Ở đây job PHẢI tồn tại, PHẢI đã chạy,
    // và PHẢI dừng ở một điểm suspend không có resume nào theo sau.
    const r = chay('globalscope')
    const moCoi = r.events.find(x => x.k === 'COROUTINE_CREATED' && x.parentId === null
      && x.builder === 'launch')!
    const id = (moCoi as { id: string }).id
    expect(r.events.some(x => x.k === 'COROUTINE_STARTED' && x.id === id)).toBe(true)
    const cuoi = r.events.filter(
      x => (x.k === 'COROUTINE_SUSPENDED' || x.k === 'COROUTINE_RESUMED') && x.id === id).at(-1)
    expect(cuoi?.k).toBe('COROUTINE_SUSPENDED')
    expect(r.output).not.toContain('dòng này không bao giờ in — chương trình đã kết thúc từ lâu')
  })
})
