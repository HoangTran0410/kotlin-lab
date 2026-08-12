import { describe, expect, it } from 'vitest'
import { DispatcherPool, DISPATCHER_POOL_SIZE } from '../../src/engine/runtime/dispatcher'

describe('DispatcherPool', () => {
  it('Main has exactly 1 thread', () => {
    expect(DISPATCHER_POOL_SIZE.Main).toBe(1)
  })

  it('acquire returns the first free thread', () => {
    const p = new DispatcherPool()
    expect(p.acquire('Main', 'j1')).toBe('Main-1')
  })

  it('acquire returns null once Main runs out of threads', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'j1')
    expect(p.acquire('Main', 'j2')).toBeNull()
  })

  it('release returns a thread to the pool', () => {
    const p = new DispatcherPool()
    const t = p.acquire('Main', 'j1')!
    p.release(t)
    expect(p.acquire('Main', 'j2')).toBe('Main-1')
  })

  it('Default has several threads, allocated in stable order', () => {
    const p = new DispatcherPool()
    expect([p.acquire('Default', 'a'), p.acquire('Default', 'b')]).toEqual(['Default-1', 'Default-2'])
  })

  it('threads of different dispatchers are independent', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'j1')
    expect(p.acquire('IO', 'j2')).toBe('IO-1')
  })

  it('allThreads groups by dispatcher, dispatcher order follows first use', () => {
    // Do NOT compare allThreads() against itself — that's trivially true and
    // tests nothing. Must assert a SPECIFIC order.
    const p = new DispatcherPool()
    p.acquire('IO', 'a')     // IO used first
    p.acquire('Main', 'b')
    const ids = p.allThreads().map(t => t.id)
    expect(ids.slice(0, 8)).toEqual([
      'IO-1', 'IO-2', 'IO-3', 'IO-4', 'IO-5', 'IO-6', 'IO-7', 'IO-8',
    ])
    expect(ids[8]).toBe('Main-1')
  })

  it('reversing usage order reverses allThreads too — proves it is not hard-coded', () => {
    const p = new DispatcherPool()
    p.acquire('Main', 'b')   // Main used first this time
    p.acquire('IO', 'a')
    const ids = p.allThreads().map(t => t.id)
    expect(ids[0]).toBe('Main-1')
    expect(ids[1]).toBe('IO-1')
  })

  it('a thread records the job currently holding it', () => {
    const p = new DispatcherPool()
    const t = p.acquire('IO', 'j9')!
    expect(p.allThreads().find(x => x.id === t)!.jobId).toBe('j9')
  })
})
