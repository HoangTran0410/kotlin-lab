import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CtxSummary, Event } from '../../src/engine/trace/events'
import { Timeline } from '../../src/ui/timeline/Timeline'

const CTX: CtxSummary = { dispatcher: 'Main', name: null, isSupervisor: false, hasHandler: false }

/** N simple PRINTLN events, enough for tests that don't care about event content. */
const makeEvents = (n: number): Event[] =>
  Array.from({ length: n }, (_, i) => ({ seq: i, t: i, k: 'PRINTLN', id: 'p', text: `line ${i}` }))

const range = (): HTMLInputElement => screen.getByLabelText('Timeline scrubber') as HTMLInputElement

describe('Timeline (Task 16) — draggable both ways', () => {
  it('dragging to step 10 calls setStep(10)', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={0} setStep={setStep} />)
    fireEvent.change(range(), { target: { value: '10' } })
    expect(setStep).toHaveBeenCalledWith(10)
  })

  it('dragging BACK from 10 to 3 calls setStep(3) — two-way dragging, the main feature', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={10} setStep={setStep} />)
    expect(range().value).toBe('10')
    fireEvent.change(range(), { target: { value: '3' } })
    expect(setStep).toHaveBeenCalledWith(3)
  })

  it('←/→ moves one step', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={5} setStep={setStep} />)
    fireEvent.keyDown(range(), { key: 'ArrowRight' })
    expect(setStep).toHaveBeenLastCalledWith(6)
    fireEvent.keyDown(range(), { key: 'ArrowLeft' })
    expect(setStep).toHaveBeenLastCalledWith(4)
  })

  it('Home/End go to 0 / events.length', () => {
    const setStep = vi.fn()
    const events = makeEvents(20)
    render(<Timeline events={events} stepIndex={7} setStep={setStep} />)
    fireEvent.keyDown(range(), { key: 'Home' })
    expect(setStep).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(range(), { key: 'End' })
    expect(setStep).toHaveBeenLastCalledWith(20)
  })

  it('max = events.length, NOT the index of root Completed — backlog item B3', () => {
    // root 'r' Completes at seq 2, but GlobalScope.launch 'g' keeps printing
    // after that (seq 3) — backlog item B3. max must cover this whole tail.
    const events: Event[] = [
      { seq: 0, t: 0, k: 'COROUTINE_CREATED', id: 'r', parentId: null, builder: 'runBlocking', ctx: CTX },
      { seq: 1, t: 1, k: 'JOB_STATE', id: 'r', from: 'New', to: 'Active' },
      { seq: 2, t: 2, k: 'JOB_STATE', id: 'r', from: 'Active', to: 'Completed' },
      { seq: 3, t: 3, k: 'PRINTLN', id: 'g', text: 'still printing after runBlocking finished' },
    ]
    render(<Timeline events={events} stepIndex={0} setStep={vi.fn()} />)
    expect(range().max).toBe(String(events.length))
    expect(range().max).not.toBe('3') // (1-based) index of the JOB_STATE Completed
  })

  it("empty trace disables the bar, doesn't throw", () => {
    expect(() => render(<Timeline events={[]} stepIndex={0} setStep={vi.fn()} />)).not.toThrow()
    expect(range().disabled).toBe(true)
  })

  it("Shift + arrow jumps 10 steps, clamped at the edge — behavior described in Task 16 step 2, not among the brief's 6 tests but a real behavior that needs locking down", () => {
    const events = makeEvents(20)

    const forward = vi.fn()
    render(<Timeline events={events} stepIndex={5} setStep={forward} />)
    fireEvent.keyDown(screen.getAllByLabelText('Timeline scrubber')[0]!, { key: 'ArrowRight', shiftKey: true })
    expect(forward).toHaveBeenLastCalledWith(15)

    const backward = vi.fn()
    render(<Timeline events={events} stepIndex={3} setStep={backward} />)
    const inputs = screen.getAllByLabelText('Timeline scrubber')
    fireEvent.keyDown(inputs[inputs.length - 1]!, { key: 'ArrowLeft', shiftKey: true })
    expect(backward).toHaveBeenLastCalledWith(0) // clamped at 0, not negative even though 3 - 10 < 0
  })
})
