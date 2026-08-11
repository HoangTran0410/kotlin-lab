import { describe, expect, it } from 'vitest'
import { edgeStyle } from '../../src/ui/graph/edges/edgeStyle'

describe('edgeStyle — ánh xạ thuần kind/blocked -> hình dáng cạnh (Task 14)', () => {
  it('ba kind cho ba hình dáng khác nhau đôi một', () => {
    const child = edgeStyle('child', false)
    const cancel = edgeStyle('cancel', false)
    const failure = edgeStyle('failure', false)
    expect(child).not.toEqual(cancel)
    expect(cancel).not.toEqual(failure)
    expect(child).not.toEqual(failure)
  })

  it('child: xám mảnh, nét liền, không mũi tên', () => {
    const v = edgeStyle('child', false)
    expect(v.stroke).toBe('var(--fg-dim)')
    expect(v.strokeWidth).toBe(1)
    expect(v.strokeDasharray).toBeUndefined()
    expect(v.markerVariant).toBe('none')
  })

  it('cancel: cam, nét đứt, có mũi tên', () => {
    const v = edgeStyle('cancel', false)
    expect(v.stroke).toBe('var(--edge-cancel)')
    expect(v.strokeDasharray).toBeDefined()
    expect(v.markerVariant).toBe('arrow')
  })

  it('failure không bị chặn: đỏ, nét liền, có mũi tên, không nhãn', () => {
    const v = edgeStyle('failure', false)
    expect(v.stroke).toBe('var(--state-cancelled)')
    expect(v.strokeDasharray).toBeUndefined()
    expect(v.markerVariant).toBe('arrow')
    expect(v.label).toBeUndefined()
  })

  it('blocked đổi kiểu dáng — failure bị chặn dùng dấu chặn thay mũi tên, kèm nhãn tiếng Việt', () => {
    const v = edgeStyle('failure', true)
    expect(v.markerVariant).toBe('block')
    expect(v.label).toBe('bị supervisor chặn')
    // Vẫn cùng gam đỏ với failure không bị chặn — chỉ ĐỔI HÌNH DÁNG, không đổi kind.
    expect(v.stroke).toBe(edgeStyle('failure', false).stroke)
  })

  it('blocked chỉ có nghĩa với failure — child bỏ qua tham số này', () => {
    expect(edgeStyle('child', true)).toEqual(edgeStyle('child', false))
  })

  it('blocked chỉ có nghĩa với failure — cancel bỏ qua tham số này', () => {
    expect(edgeStyle('cancel', true)).toEqual(edgeStyle('cancel', false))
  })
})
