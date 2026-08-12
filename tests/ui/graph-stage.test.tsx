import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { narrateTrace } from '../../src/engine/narrate/narrateTrace'

/**
 * Sân khấu đồ thị: câu giải thích, nút tua theo MỐC, và bảng gỡ lỗi đóng sẵn.
 *
 * Ba thứ này tồn tại để người học không phải nhìn bốn góc màn hình. Test ở đây
 * canh đúng điều đó — không phải canh "component có render ra không".
 */
describe('sân khấu đồ thị — hiểu được mà không cần nhìn đi chỗ khác', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
  })

  it('bảng gỡ lỗi ĐÓNG sẵn: không có console, không có thanh timeline từng event', () => {
    render(<App />)
    expect(screen.queryByLabelText('Thanh kéo dòng thời gian')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Phát' })).toBeNull()
    // Nhưng đồ thị vẫn phải có đủ đồ nghề của riêng nó.
    expect(screen.getByRole('button', { name: 'Phát theo mốc' })).toBeInTheDocument()
    expect(screen.getByTestId('stage-caption')).toBeInTheDocument()
  })

  it('mở bảng gỡ lỗi thì console và thanh timeline xuất hiện, đóng lại thì biến mất', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ lỗi sâu' }))
    expect(screen.getByLabelText('Thanh kéo dòng thời gian')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng bảng gỡ lỗi' }))
    expect(screen.queryByLabelText('Thanh kéo dòng thời gian')).toBeNull()
  })

  it('câu giải thích ĐỔI khi tua, và cả hai lần đều có chữ thật', () => {
    render(<App />)
    const tổng = useLabStore.getState().compiled.events.length
    expect(tổng, 'fixture phải đủ dài').toBeGreaterThan(20)

    act(() => useLabStore.getState().setStep(Math.floor(tổng / 3)))
    const sớm = screen.getByTestId('stage-caption').textContent ?? ''
    act(() => useLabStore.getState().setStep(tổng))
    const muộn = screen.getByTestId('stage-caption').textContent ?? ''

    // Bất-vô-nghĩa TRƯỚC khi so: hai chuỗi rỗng cũng "khác nhau" một cách vô ích.
    expect(sớm.length).toBeGreaterThan(10)
    expect(muộn.length).toBeGreaterThan(10)
    expect(sớm).not.toBe(muộn)
  })

  it('nút ▶| nhảy tới MỐC kế tiếp, không phải +1 event', () => {
    render(<App />)
    const events = useLabStore.getState().compiled.events
    const mốc = narrateTrace(events).map(l => l.index)
    // Trace này phải có ít nhất một chỗ hai mốc cách nhau hơn 1 event, nếu
    // không thì "nhảy theo mốc" và "+1" trùng nhau và test không phân biệt được.
    const cóKhoảngTrống = mốc.some((v, i) => i > 0 && v - mốc[i - 1]! > 1)
    expect(cóKhoảngTrống, 'fixture không có khoảng trống giữa hai mốc').toBe(true)

    act(() => useLabStore.getState().setStep(0))
    const đãQua: number[] = []
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Mốc sau' }))
      đãQua.push(useLabStore.getState().stepIndex)
    }
    // Mỗi lần bấm phải dừng ĐÚNG sau một mốc — tức stepIndex - 1 là chỉ số mốc.
    for (const s of đãQua) {
      expect(mốc, `dừng ở step ${s} không phải một mốc`).toContain(s - 1)
    }
    expect(new Set(đãQua).size, 'bấm nhiều lần mà không tiến').toBe(đãQua.length)
  })

  it('◀ lùi về mốc trước, không kẹt tại chỗ', () => {
    render(<App />)
    const tổng = useLabStore.getState().compiled.events.length
    act(() => useLabStore.getState().setStep(tổng))
    const trước = useLabStore.getState().stepIndex
    fireEvent.click(screen.getByRole('button', { name: 'Mốc trước' }))
    expect(useLabStore.getState().stepIndex).toBeLessThan(trước)
  })

  it('println hiện NGAY TRÊN node đã in nó, không chỉ ở console', async () => {
    render(<App />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="job-node"]').length).toBeGreaterThan(0)
    })
    act(() => useLabStore.getState().setStep(useLabStore.getState().compiled.events.length))

    // Lesson supervisor in "A xong" và "C xong" từ hai launch khác nhau.
    await waitFor(() => {
      const nodes = [...document.querySelectorAll('[data-testid="job-node"]')]
      const inRa = nodes.map(n => n.textContent ?? '').filter(t => t.includes('xong'))
      expect(inRa.length, 'không node nào hiện dòng println của mình').toBeGreaterThanOrEqual(2)
    })
    // Và console vẫn còn nguyên trong bảng gỡ lỗi — không phải thay thế, mà là
    // thêm. Phải TÌM TRONG console: giờ "A xong" xuất hiện ở CẢ node lẫn
    // console, và một `getByText` trần sẽ đỏ vì tìm thấy nhiều nơi — bản thân
    // việc đó đã là bằng chứng tính năng chạy.
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ lỗi sâu' }))
    const console_ = document.querySelector('.console, [data-testid="console"]')
      ?? screen.getByText('Console').closest('.panel')!
    expect(console_.textContent).toContain('A xong')
  })
})
