import { describe, expect, it } from 'vitest'
import { parseProgram } from '../../src/engine/parser/parser'

describe('parser — chương trình', () => {
  it('fun main() có thân khối', () => {
    const p = parseProgram('fun main() {\n  println("hi")\n}')
    expect(p.funs).toHaveLength(1)
    expect(p.funs[0]).toMatchObject({ name: 'main', isSuspend: false, exprBody: null })
    expect(p.funs[0]!.body!.stmts).toHaveLength(1)
  })

  it('fun main() = runBlocking { } dùng exprBody', () => {
    const p = parseProgram('fun main() = runBlocking {\n  delay(1)\n}')
    expect(p.funs[0]).toMatchObject({
      name: 'main', body: null,
      exprBody: { k: 'Call', callee: { k: 'Ident', name: 'runBlocking' } },
    })
  })

  it('suspend fun được đánh dấu', () => {
    const p = parseProgram('suspend fun work() {\n  delay(1)\n}')
    expect(p.funs[0]).toMatchObject({ name: 'work', isSuspend: true })
  })

  it('tham số có kiểu và giá trị mặc định', () => {
    const p = parseProgram('fun f(name: String, n: Int = 3) {\n}')
    expect(p.funs[0]!.params).toMatchObject([
      { name: 'name', type: 'String', defaultValue: null },
      { name: 'n', type: 'Int', defaultValue: { k: 'NumberLit', value: 3 } },
    ])
  })

  it('nhiều hàm và khai báo top-level', () => {
    const p = parseProgram('val g = 1\nfun a() {\n}\nfun b() {\n}')
    expect(p.funs.map(f => f.name)).toEqual(['a', 'b'])
    expect(p.topLevel).toMatchObject([{ k: 'ValDecl', name: 'g' }])
  })

  it('bỏ qua dòng import', () => {
    const p = parseProgram('import kotlinx.coroutines.*\nfun main() {\n}')
    expect(p.funs.map(f => f.name)).toEqual(['main'])
    expect(p.topLevel).toHaveLength(0)
  })
})
