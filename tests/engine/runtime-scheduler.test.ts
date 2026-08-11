import { describe, expect, it } from 'vitest'
import { Scheduler } from '../../src/engine/runtime/scheduler'
import type { CoroutineBody } from '../../src/engine/runtime/suspension'

const collectPrints = (s: Scheduler) =>
  s.emitter.events.filter(e => e.k === 'PRINTLN').map(e => (e as { text: string }).text)

describe('Scheduler', () => {
  it('chạy một coroutine không suspend', () => {
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): CoroutineBody { s.println('hi') })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['hi'])
    expect(root.state).toBe('Completed')
  })

  it('delay đẩy thời gian ảo, không ngủ thật', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      yield { s: 'delay', ms: 1000 }
      s.println('sau delay')
    })
    const start = Date.now()
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['sau delay'])
    expect(s.clock.now).toBe(1000)
    expect(Date.now() - start).toBeLessThan(200) // không ngủ thật
  })

  it('hai coroutine xen kẽ theo thời gian delay', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      s.spawnChild(function* (): CoroutineBody {
        yield { s: 'delay', ms: 200 }; s.println('B')
      })
      s.spawnChild(function* (): CoroutineBody {
        yield { s: 'delay', ms: 100 }; s.println('A')
      })
      yield { s: 'delay', ms: 300 }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B'])
  })

  it('phát COROUTINE_SUSPENDED rồi COROUTINE_RESUMED', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody { yield { s: 'delay', ms: 10 } })
    s.runToCompletion()
    const kinds = s.emitter.events.map(e => e.k)
    expect(kinds).toContain('COROUTINE_SUSPENDED')
    expect(kinds).toContain('COROUTINE_RESUMED')
  })

  it('exception trong thân coroutine thành failure của Job', () => {
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): CoroutineBody {
      throw Object.assign(new Error('boom'), { kotlinType: 'RuntimeException' })
    })
    s.runToCompletion()
    expect(root.state).toBe('Cancelled')
    expect(root.cause?.exType).toBe('RuntimeException')
  })

  it('chạy lại cùng chương trình cho trace y hệt — deterministic', () => {
    const build = () => {
      const s = new Scheduler()
      s.spawnRoot(function* (): CoroutineBody {
        s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 50 }; s.println('x') })
        s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 50 }; s.println('y') })
        yield { s: 'delay', ms: 100 }
      })
      s.runToCompletion()
      return JSON.stringify(s.emitter.events)
    }
    expect(build()).toBe(build())
  })

  it('runToCompletion dừng, không lặp vô hạn khi hết việc', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody { yield { s: 'yield' } })
    s.runToCompletion()
    expect(s.emitter.events.length).toBeGreaterThan(0)
  })

  it('join thật sự chờ job kia xong rồi mới chạy tiếp', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      const child = s.spawnChild(function* (): CoroutineBody {
        yield { s: 'delay', ms: 100 }
        s.println('child xong')
      })
      yield { s: 'join', jobId: child.id }
      s.println('sau join')
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['child xong', 'sau join'])
  })

  it('join KHÔNG chặn đồng hồ ảo tiến lên — chống hồi quy deadlock', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      const child = s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 500 } })
      yield { s: 'join', jobId: child.id }
    })
    s.runToCompletion()
    expect(s.clock.now).toBe(500)
  })

  it('yield đưa coroutine TRỞ LẠI hàng đợi, không bỏ rơi nó', () => {
    // Nếu xoá hẳn nhánh 'yield' trong suspend(), task bị bỏ rơi: 'sau' không
    // bao giờ in và job kẹt ở Active mãi. Không test nào khác bắt được điều
    // đó, vì chúng chỉ khẳng định các tác dụng phụ xảy ra TRƯỚC điểm yield.
    const s = new Scheduler()
    const root = s.spawnRoot(function* (): CoroutineBody {
      s.println('trước')
      yield { s: 'yield' }
      s.println('sau')
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['trước', 'sau'])
    expect(root.state).toBe('Completed')
  })

  it('ready là FIFO — nhiều coroutine sẵn sàng CÙNG LÚC chạy theo thứ tự tạo', () => {
    // Mọi test khác dùng delay khác nhau, nên thứ tự do ĐỒNG HỒ quyết định và
    // tính FIFO của ready không bao giờ bị chạm tới. Ở đây không có delay nào,
    // nên thứ tự in ra lộ thẳng thứ tự lấy khỏi hàng đợi: shift -> A,B,C;
    // pop -> C,B,A.
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      s.spawnChild(function* (): CoroutineBody { s.println('A') })
      s.spawnChild(function* (): CoroutineBody { s.println('B') })
      s.spawnChild(function* (): CoroutineBody { s.println('C') })
      yield { s: 'yield' }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'C'])
  })

  // GHI CHÚ TRUNG THỰC: test này KHÔNG phân biệt được shift() với pop().
  // Đã kiểm chứng: với pop(), thứ tự tạo bị đảo rồi thứ tự resume bị đảo lần
  // nữa, hai lần triệt tiêu nhau và kết quả vẫn A,B,C. Nó chốt hành vi
  // đầu-cuối (đồng hồ + scheduler khớp nhau), không chốt kỷ luật hàng đợi.
  // Test không-delay ở trên mới là cái canh FIFO.
  it('cùng mốc delay thì vẫn resume theo thứ tự tạo', () => {
    const s = new Scheduler()
    s.spawnRoot(function* (): CoroutineBody {
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 100 }; s.println('A') })
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 100 }; s.println('B') })
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 100 }; s.println('C') })
      yield { s: 'delay', ms: 200 }
    })
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'C'])
  })

  it('joinChildren chờ mọi child, kể cả child chậm nhất', () => {
    const s = new Scheduler()
    s.spawnRoot(rootJob => (function* (): CoroutineBody {
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 100 }; s.println('A') })
      s.spawnChild(function* (): CoroutineBody { yield { s: 'delay', ms: 300 }; s.println('B') })
      yield { s: 'joinChildren', jobId: rootJob.id }
      s.println('scope xong')
    })())
    s.runToCompletion()
    expect(collectPrints(s)).toEqual(['A', 'B', 'scope xong'])
  })
})
