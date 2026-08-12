import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { coroutineDangDo } from '../../src/engine/trace/leftover'
import { runSource } from '../../src/engine/run'

/**
 * Ca thật mà người dùng gặp: chương trình không có `runBlocking`, nên `main`
 * trả về ngay và mọi coroutine vừa phóng ra bị bỏ lại ở `delay`. Output rỗng,
 * đồ thị đầy node đứng im, KHÔNG một chữ nào nói vì sao.
 *
 * Kotlin thật cũng cho ra output rỗng cho đúng chương trình này (đã đối chiếu
 * playground 2.1.20) — nên engine không sai. Cái sai là im lặng.
 */
const KHONG_RUNBLOCKING = `import kotlinx.coroutines.*

fun main() {
    val pham = CoroutineScope(SupervisorJob())
    pham.launch {
        launch { delay(500); throw RuntimeException("Child 1 failed") }
        launch { delay(1000); println("Child 2 finished") }
    }
}
`

const nap = (src: string): void => {
  act(() => { useLabStore.getState().loadSource(src) })
}

describe('coroutine bị bỏ lại giữa chừng', () => {
  beforeEach(() => {
    // `loadSource('')` chứ không phải `setState({ source: '' })`: store là biến
    // module dùng chung cho cả file, và setState KHÔNG biên dịch lại — nên
    // `compiled` của ca trước còn nguyên, và ca cuối cùng nhận trace của
    // globalscope. Đã đo: nó đỏ đúng vì lý do đó.
    act(() => { useLabStore.getState().loadSource('') })
  })

  it('nhận đúng những job chưa kết thúc, không kể job đã xong', () => {
    const r = runSource(KHONG_RUNBLOCKING)
    expect(r.diagnostics).toEqual([])
    expect(r.output, 'chương trình này không in được gì — giống hệt JVM thật').toEqual([])
    const { jobs } = coroutineDangDo(r.events)
    // Bốn cái dang dở: job gốc của scope, launch cha, và hai launch con. Root
    // runBlocking thì đã Completed nên KHÔNG được có mặt.
    expect(jobs).toHaveLength(4)
    expect(jobs.every(j => j.state !== 'Completed' && j.state !== 'Cancelled')).toBe(true)
    expect(jobs.some(j => j.builder === 'runBlocking'), 'job đã xong lại bị kể là dang dở').toBe(false)
  })

  it('hiện ghi chú, kèm gợi ý runBlocking khi file không có runBlocking nào', () => {
    render(<App />)
    nap(KHONG_RUNBLOCKING)
    const note = screen.getByTestId('leftover-notice')
    expect(note).toHaveTextContent('4 coroutine bị bỏ lại giữa chừng')
    expect(note).toHaveTextContent(/Không có .*runBlocking.* nào trong file/)
  })

  it('KHÔNG hiện khi mọi coroutine đều chạy xong', () => {
    // Nếu ghi chú hiện cả lúc bình thường thì nó thành nhiễu và người ta học
    // cách bỏ qua nó — đúng lúc cần đọc thì không đọc nữa.
    render(<App />)
    nap(lessonSource('suspend')!)
    expect(screen.queryByTestId('leftover-notice')).toBeNull()
  })

  it('vẫn hiện khi CÓ runBlocking, nhưng không nhắc runBlocking nữa', () => {
    // GlobalScope: có runBlocking, chương trình vẫn bỏ lại một coroutine. Gợi
    // ý "thêm runBlocking" ở đây sẽ là lời khuyên sai.
    render(<App />)
    nap(lessonSource('globalscope')!)
    const note = screen.getByTestId('leftover-notice')
    expect(note).toHaveTextContent('1 coroutine bị bỏ lại giữa chừng')
    expect(note.textContent).not.toMatch(/Không có .*runBlocking.* nào trong file/)
  })

  it('không hiện gì khi chưa có code nào', () => {
    render(<App />)
    expect(screen.queryByTestId('leftover-notice')).toBeNull()
  })
})
