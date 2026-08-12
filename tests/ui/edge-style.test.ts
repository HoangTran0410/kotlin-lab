import { describe, expect, it } from 'vitest'
import { edgeStyle } from '../../src/ui/graph/edges/edgeStyle'

describe('edgeStyle — pure kind/blocked -> edge shape mapping (Task 14)', () => {
  it('the three kinds give three pairwise-different shapes', () => {
    const child = edgeStyle('child', false)
    const cancel = edgeStyle('cancel', false)
    const failure = edgeStyle('failure', false)
    expect(child).not.toEqual(cancel)
    expect(cancel).not.toEqual(failure)
    expect(child).not.toEqual(failure)
  })

  it('child: thin gray, solid line, no arrow', () => {
    const v = edgeStyle('child', false)
    expect(v.stroke).toBe('var(--fg-dim)')
    expect(v.strokeWidth).toBe(1)
    expect(v.strokeDasharray).toBeUndefined()
    expect(v.markerVariant).toBe('none')
  })

  it('cancel: orange, dashed line, has an arrow', () => {
    const v = edgeStyle('cancel', false)
    expect(v.stroke).toBe('var(--edge-cancel)')
    expect(v.strokeDasharray).toBeDefined()
    expect(v.markerVariant).toBe('arrow')
  })

  it('failure not blocked: red, solid line, has an arrow, no label', () => {
    const v = edgeStyle('failure', false)
    expect(v.stroke).toBe('var(--state-cancelled)')
    expect(v.strokeDasharray).toBeUndefined()
    expect(v.markerVariant).toBe('arrow')
    expect(v.label).toBeUndefined()
  })

  it('blocked changes the shape — a blocked failure uses a block mark instead of an arrow, with a label', () => {
    const v = edgeStyle('failure', true)
    expect(v.markerVariant).toBe('block')
    expect(v.label).toBe('blocked by supervisor')
    // Still the same red hue as an unblocked failure — only the SHAPE changes, not the kind.
    expect(v.stroke).toBe(edgeStyle('failure', false).stroke)
  })

  it('blocked only matters for failure — child ignores this parameter', () => {
    expect(edgeStyle('child', true)).toEqual(edgeStyle('child', false))
  })

  it('blocked only matters for failure — cancel ignores this parameter', () => {
    expect(edgeStyle('cancel', true)).toEqual(edgeStyle('cancel', false))
  })
})
