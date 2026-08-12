import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { MAX_LEFT, MIN_LEFT } from '../../src/ui/layout/usePanelWidths'

/**
 * jsdom KHÔNG cài `PointerEvent`, nên `fireEvent.pointerMove(el, { clientX })`
 * tạo ra một Event trơn và `clientX` không bao giờ tới được handler (đã đo:
 * `clientX = undefined`). Dựng `MouseEvent` — jsdom có, và nó mang clientX
 * thật — rồi phát dưới đúng tên sự kiện mà React đang nghe.
 */
function keo(el: Element, ten: string, clientX: number): void {
  // Bọc `act`: `dispatchEvent` trần KHÔNG được React gói lại như `fireEvent`,
  // nên setState trong handler chưa được flush trước lúc assert — đo được là
  // bề rộng vẫn ở giá trị cũ dù handler đã chạy đúng.
  act(() => { el.dispatchEvent(new MouseEvent(ten, { clientX, bubbles: true })) })
}

const beRongCot = (): number => {
  const main = document.querySelector('.shell__main') as HTMLElement
  return parseInt(main.style.getPropertyValue('--w-left'), 10)
}

describe('kéo giãn cột', () => {
  beforeEach(() => {
    localStorage.clear()
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
  })

  it('kéo thanh giữa làm cột mã rộng ra đúng khoảng đã kéo', () => {
    render(<App />)
    const thanh = screen.getByTestId('splitter-Bề rộng cột mã')
    const truoc = beRongCot()

    keo(thanh, 'pointerdown', 500)
    keo(thanh, 'pointermove', 620)
    keo(thanh, 'pointerup', 620)

    expect(beRongCot()).toBe(truoc + 120)
  })

  it('kéo quá mức bị kẹp vào biên, không cho cột biến mất hay nuốt cả màn hình', () => {
    render(<App />)
    const thanh = screen.getByTestId('splitter-Bề rộng cột mã')

    keo(thanh, 'pointerdown', 500)
    keo(thanh, 'pointermove', -5000)
    expect(beRongCot()).toBe(MIN_LEFT)
    keo(thanh, 'pointermove', 5000)
    expect(beRongCot()).toBe(MAX_LEFT)
    keo(thanh, 'pointerup', 5000)
  })

  it('mũi tên trái/phải cũng kéo được — không bỏ rơi người dùng bàn phím', () => {
    render(<App />)
    const thanh = screen.getByTestId('splitter-Bề rộng cột mã')
    const truoc = beRongCot()
    fireEvent.keyDown(thanh, { key: 'ArrowRight' })
    expect(beRongCot()).toBeGreaterThan(truoc)
    fireEvent.keyDown(thanh, { key: 'ArrowLeft' })
    expect(beRongCot()).toBe(truoc)
  })

  it('nhớ bề rộng qua lần mở sau', () => {
    const { unmount } = render(<App />)
    const thanh = screen.getByTestId('splitter-Bề rộng cột mã')
    fireEvent.keyDown(thanh, { key: 'ArrowRight', shiftKey: true })
    const daKeo = beRongCot()
    unmount()

    render(<App />)
    expect(beRongCot(), 'mở lại mà bề rộng về mặc định').toBe(daKeo)
  })

  it('"Bố cục mặc định" đưa về mức ban đầu', () => {
    render(<App />)
    const thanh = screen.getByTestId('splitter-Bề rộng cột mã')
    fireEvent.keyDown(thanh, { key: 'ArrowRight', shiftKey: true })
    const daKeo = beRongCot()
    fireEvent.click(screen.getByRole('button', { name: 'Bố cục mặc định' }))
    expect(beRongCot()).toBeLessThan(daKeo)
  })

  it('thanh kéo cột gỡ lỗi chỉ có mặt khi bảng gỡ lỗi đang mở', () => {
    render(<App />)
    expect(screen.queryByTestId('splitter-Bề rộng cột gỡ lỗi')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ lỗi sâu' }))
    expect(screen.getByTestId('splitter-Bề rộng cột gỡ lỗi')).toBeInTheDocument()
  })

  it('event kéo thiếu toạ độ KHÔNG làm bề rộng thành NaN', () => {
    // Chính là ca đã lộ ra khi viết test này: thiếu chặn thì `--w-left: NaNpx`
    // và cả lưới sụp.
    //
    // Phạm vi canh gác, đã đo bằng cách phá thật: Splitter có HAI chỗ chặn
    // (bỏ qua pointerdown thiếu toạ độ, và `kep` trả về giá trị cũ khi gặp
    // NaN), mỗi chỗ TỰ NÓ đã đủ — gỡ một chỗ thì ca này vẫn xanh, gỡ cả hai
    // mới đỏ. Vậy nó canh TÍNH CHẤT "bề rộng luôn là số hữu hạn", không phải
    // sự tồn tại của một dòng cụ thể. Ghi rõ ở đây để người sau không tưởng
    // nó bảo vệ nhiều hơn thực tế.
    render(<App />)
    const thanh = screen.getByTestId('splitter-Bề rộng cột mã')
    const truoc = beRongCot()
    fireEvent.pointerDown(thanh, { pointerId: 1 })
    fireEvent.pointerMove(thanh, { pointerId: 1 })
    expect(Number.isFinite(beRongCot())).toBe(true)
    expect(beRongCot()).toBe(truoc)
  })

  it('dữ liệu hỏng trong localStorage không làm vỡ app', () => {
    localStorage.setItem('kcl.panels.v1', 'không phải json')
    render(<App />)
    expect(beRongCot()).toBeGreaterThanOrEqual(MIN_LEFT)
  })
})
