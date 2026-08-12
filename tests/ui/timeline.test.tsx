import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CtxSummary, Event } from '../../src/engine/trace/events'
import { Timeline } from '../../src/ui/timeline/Timeline'

const CTX: CtxSummary = { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false }

/** N event PRINTLN đơn giản, đủ dùng cho các test không quan tâm nội dung event. */
const makeEvents = (n: number): Event[] =>
  Array.from({ length: n }, (_, i) => ({ seq: i, t: i, k: 'PRINTLN', id: 'p', text: `dòng ${i}` }))

const range = (): HTMLInputElement => screen.getByLabelText('Thanh kéo dòng thời gian') as HTMLInputElement

describe('Timeline (Task 16) — kéo được hai chiều', () => {
  it('kéo tới step 10 thì setStep(10)', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={0} setStep={setStep} />)
    fireEvent.change(range(), { target: { value: '10' } })
    expect(setStep).toHaveBeenCalledWith(10)
  })

  it('kéo LÙI từ 10 về 3 thì setStep(3) — kéo hai chiều, tính năng chính', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={10} setStep={setStep} />)
    expect(range().value).toBe('10')
    fireEvent.change(range(), { target: { value: '3' } })
    expect(setStep).toHaveBeenCalledWith(3)
  })

  it('←/→ đi một bước', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={5} setStep={setStep} />)
    fireEvent.keyDown(range(), { key: 'ArrowRight' })
    expect(setStep).toHaveBeenLastCalledWith(6)
    fireEvent.keyDown(range(), { key: 'ArrowLeft' })
    expect(setStep).toHaveBeenLastCalledWith(4)
  })

  it('Home/End về 0 / events.length', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={7} setStep={setStep} />)
    fireEvent.keyDown(range(), { key: 'Home' })
    expect(setStep).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(range(), { key: 'End' })
    expect(setStep).toHaveBeenLastCalledWith(20)
  })

  it('max = events.length, KHÔNG phải chỉ số của root Completed — tồn đọng B3', () => {
    // root 'r' Completed ở seq 2, nhưng GlobalScope.launch 'g' còn in tiếp
    // sau đó (seq 3) — tồn đọng B3. max phải bao trọn cả phần đuôi này.
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'r', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 1, k: 'JOB_STATE', id: 'r', from: 'New', to: 'Active' },
      { seq: 2, t: 2, k: 'JOB_STATE', id: 'r', from: 'Active', to: 'Completed' },
      { seq: 3, t: 3, k: 'PRINTLN', id: 'g', text: 'còn in sau khi runBlocking xong' },
    ]
    render(<Timeline events={events} stepIndex={0} setStep={vi.fn()} />)
    expect(range().max).toBe(String(events.length))
    expect(range().max).not.toBe('3') // chỉ số (1-based) của JOB_STATE Completed
  })

  it('trace rỗng thì thanh vô hiệu hoá, không ném', () => {
    expect(() => render(<Timeline events={[]} stepIndex={0} setStep={vi.fn()} />)).not.toThrow()
    expect(range().disabled).toBe(true)
  })

  it('Shift + mũi tên nhảy 10 bước, kẹp ở biên — hành vi mô tả ở Task 16 bước 2, không nằm trong 6 test của brief nhưng là hành vi thật cần khoá', () => {
    const events = makeEvents(20)

    const forward = vi.fn()
    render(<Timeline events={events} stepIndex={5} setStep={forward} />)
    fireEvent.keyDown(screen.getAllByLabelText('Thanh kéo dòng thời gian')[0]!, { key: 'ArrowRight', shiftKey: true })
    expect(forward).toHaveBeenLastCalledWith(15)

    const backward = vi.fn()
    render(<Timeline events={events} stepIndex={3} setStep={backward} />)
    const inputs = screen.getAllByLabelText('Thanh kéo dòng thời gian')
    fireEvent.keyDown(inputs[inputs.length - 1]!, { key: 'ArrowLeft', shiftKey: true })
    expect(backward).toHaveBeenLastCalledWith(0) // kẹp ở 0, không âm dù 3 - 10 < 0
  })
})
