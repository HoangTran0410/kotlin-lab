import { describe, expect, it } from 'vitest'
import { DispatcherPool, DISPATCHER_POOL_SIZE } from '../../src/engine/runtime/dispatcher'

describe('DispatcherPool', () => {
  it('Main chỉ có đúng 1 thread', () => {
    expect(DISPATCHER_POOL_SIZE.Main).toBe(1)
  })

  it('acquire trả thread rảnh đầu tiên', () => {
    const p = new DispatcherPool()
    expect(p.acquire('Main', 'j1')).toBe('Main-1')
  })

  it('Main hết thread thì acquire trả null', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'j1')
    expect(p.acquire('Main', 'j2')).toBeNull()
  })

  it('release trả thread về pool', () => {
    const p = new DispatcherPool()
    const t = p.acquire('Main', 'j1')!
    p.release(t)
    expect(p.acquire('Main', 'j2')).toBe('Main-1')
  })

  it('Default có nhiều thread, cấp phát theo thứ tự ổn định', () => {
    const p = new DispatcherPool()
    expect([p.acquire('Default', 'a'), p.acquire('Default', 'b')]).toEqual(['Default-1', 'Default-2'])
  })

  it('thread của dispatcher khác nhau độc lập', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'j1')
    expect(p.acquire('IO', 'j2')).toBe('IO-1')
  })

  it('allThreads gom theo dispatcher, thứ tự dispatcher theo lần dùng đầu tiên', () => {
    // KHÔNG so sánh allThreads() với chính nó — phép đó luôn đúng và không
    // kiểm được gì. Phải khẳng định thứ tự CỤ THỂ.
    const p = new DispatcherPool()
    p.acquire('IO', 'a')     // IO được dùng trước
    p.acquire('Main', 'b')
    const ids = p.allThreads().map(t => t.id)
    expect(ids.slice(0, 8)).toEqual([
      'IO-1', 'IO-2', 'IO-3', 'IO-4', 'IO-5', 'IO-6', 'IO-7', 'IO-8',
    ])
    expect(ids[8]).toBe('Main-1')
  })

  it('đảo thứ tự dùng thì allThreads đảo theo — chứng minh không hard-code', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'b')   // lần này Main trước
    p.acquire('IO', 'a')
    const ids = p.allThreads().map(t => t.id)
    expect(ids[0]).toBe('Main-1')
    expect(ids[1]).toBe('IO-1')
  })

  it('thread ghi lại job đang giữ nó', () => {
    const p = new DispatcherPool()
    const t = p.acquire('IO', 'j9')!
    expect(p.allThreads().find(x => x.id === t)!.jobId).toBe('j9')
  })
})
