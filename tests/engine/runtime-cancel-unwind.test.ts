import { describe, expect, it } from 'vitest'
import { runSource } from '../../src/engine/run'

const out = (src: string) => runSource(src).output

describe('cancel làm unwind thân coroutine', () => {
  it('finally chạy khi cancel lúc coroutine đang suspend', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000); println("xong") } finally { println("dọn dẹp") } }\n' +
      '  j.cancel()\n' +
      '}')).toEqual(['dọn dẹp'])
  })

  it('phần thân sau điểm suspend KHÔNG chạy khi bị cancel', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { delay(1000); println("khong-duoc-in") }\n' +
      '  j.cancel()\n' +
      '}')).toEqual([])
  })

  it('finally lồng nhau chạy từ trong ra ngoài', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch {\n' +
      '    try {\n' +
      '      try { delay(1000) } finally { println("trong") }\n' +
      '    } finally { println("ngoài") }\n' +
      '  }\n' +
      '  j.cancel()\n' +
      '}')).toEqual(['trong', 'ngoài'])
  })

  it('cancel cha làm finally của con chạy', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val p = launch {\n' +
      '    launch { try { delay(1000) } finally { println("con dọn dẹp") } }\n' +
      '    delay(1000)\n' +
      '  }\n' +
      '  p.cancel()\n' +
      '}')).toEqual(['con dọn dẹp'])
  })

  it('coroutine chưa từng chạy thì không có gì để unwind', () => {
    expect(() => out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { println("khong-chay") }\n' +
      '  j.cancel()\n' +
      '}')).not.toThrow()
  })

  it('cancel không làm treo chương trình', () => {
    expect(out(
      'fun main() = runBlocking {\n' +
      '  val j = launch { try { delay(1000) } finally { println("xong dọn") } }\n' +
      '  j.cancel()\n' +
      '  println("sau cancel")\n' +
      '}')).toEqual(['xong dọn', 'sau cancel'])
  })
})
