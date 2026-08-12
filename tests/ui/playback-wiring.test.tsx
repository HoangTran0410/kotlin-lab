import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from '../../src/ui/App'
import { useLabStore } from '../../src/state/store'
import { lessonSource } from '../../src/lessons/registry'
import { openDebug } from './helpers/openDebug'

/**
 * "Nối dây" theo đúng bài học Task 9/13/16: usePlayback.ts được test kỹ ở
 * tầng hook (playback.test.tsx) bằng một store giả tự chế — không thể bắt
 * lỗi kiểu "App quên mount PlaybackControls" hay "App truyền nhầm setStep của
 * một store khác". Test này ghép <App /> thật, bấm nút DOM thật, và xác nhận
 * store Zustand thật (useLabStore) di chuyển theo thời gian giả.
 */
describe('nối dây App -> PlaybackControls — play/pause thật lái store thật', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('bấm Phát tiến stepIndex thật của store theo thời gian; bấm Tạm dừng thì đứng', async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    // useLayout (Task 15) chạy ELK bất đồng bộ qua Promise thật — Promise
    // không bị @sinonjs/fake-timers can thiệp (chỉ macrotask timer bị giả),
    // nên `.then()` của nó resolve như MICROTASK bình thường. `act(fn)` ĐỒNG
    // BỘ không đợi microtask xả hết trước khi trả về — phải `await act(async
    // () => {...})` (xem các advanceTimersByTime bên dưới) để React chờ hết
    // continuation bất đồng bộ trước khi coi act() đã xong, nếu không setState
    // của useLayout tới muộn NGOÀI act() và React cảnh báo "not wrapped in act".
    await act(async () => {})

    const total = useLabStore.getState().compiled.events.length
    expect(total, 'fixture supervisor cần đủ event để test có ý nghĩa').toBeGreaterThan(3)

    const playBtn = screen.getByRole('button', { name: 'Phát' })
    fireEvent.click(playBtn)
    expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(1040) }) // tốc độ mặc định 1×, dư một khung rAF
    expect(useLabStore.getState().stepIndex).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }))
    expect(screen.getByRole('button', { name: 'Phát' })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(useLabStore.getState().stepIndex).toBe(1) // đứng im sau khi tạm dừng
  })

  it('kéo Timeline trong lúc đang phát thì play tự dừng — không giằng co với ngón tay', async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    // useLayout (Task 15) chạy ELK bất đồng bộ qua Promise thật — Promise
    // không bị @sinonjs/fake-timers can thiệp (chỉ macrotask timer bị giả),
    // nên `.then()` của nó resolve như MICROTASK bình thường. `act(fn)` ĐỒNG
    // BỘ không đợi microtask xả hết trước khi trả về — phải `await act(async
    // () => {...})` (xem các advanceTimersByTime bên dưới) để React chờ hết
    // continuation bất đồng bộ trước khi coi act() đã xong, nếu không setState
    // của useLayout tới muộn NGOÀI act() và React cảnh báo "not wrapped in act".
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Phát' }))
    expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeInTheDocument()

    const range = screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement
    fireEvent.change(range, { target: { value: '20' } })
    expect(useLabStore.getState().stepIndex).toBe(20)

    // Nút phải quay lại "Phát" — play đã dừng vì user tự kéo.
    expect(screen.getByRole('button', { name: 'Phát' })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(useLabStore.getState().stepIndex).toBe(20) // không tự tiến tiếp
  })

  it('bước Tiến/Lùi thủ công gọi đúng setStep của store thật', async () => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    useLabStore.getState().setSource(lessonSource('supervisor')!)
    render(<App />)
    openDebug()
    // useLayout (Task 15) chạy ELK bất đồng bộ qua Promise thật — Promise
    // không bị @sinonjs/fake-timers can thiệp (chỉ macrotask timer bị giả),
    // nên `.then()` của nó resolve như MICROTASK bình thường. `act(fn)` ĐỒNG
    // BỘ không đợi microtask xả hết trước khi trả về — phải `await act(async
    // () => {...})` (xem các advanceTimersByTime bên dưới) để React chờ hết
    // continuation bất đồng bộ trước khi coi act() đã xong, nếu không setState
    // của useLayout tới muộn NGOÀI act() và React cảnh báo "not wrapped in act".
    await act(async () => {})
    act(() => { useLabStore.getState().setStep(5) })

    fireEvent.click(screen.getByRole('button', { name: 'Tiến một bước' }))
    expect(useLabStore.getState().stepIndex).toBe(6)

    fireEvent.click(screen.getByRole('button', { name: 'Lùi một bước' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lùi một bước' }))
    expect(useLabStore.getState().stepIndex).toBe(4)
  })
})
