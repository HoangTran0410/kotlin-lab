import { describe, expect, it } from 'vitest'
import { runSourceSafe } from '../../src/engine/run'
import { buildGraphSpec, type GraphSpec } from '../../src/engine/trace/graph'
import { LESSON_LIST, lessonSource } from '../../src/lessons/registry'
import { layoutGraph } from '../../src/ui/graph/elkLayout'
import { NODE_H } from '../../src/ui/graph/dimensions'

const specFor = (id: string): GraphSpec => buildGraphSpec(runSourceSafe(lessonSource(id)!).events)

// So sánh giá trị, không phụ thuộc thứ tự chèn Map — điều đang được kiểm ở
// đây là TOẠ ĐỘ có đổi giữa hai lần chạy hay không, không phải thứ tự duyệt.
const normalize = (boxes: Awaited<ReturnType<typeof layoutGraph>>): string =>
  JSON.stringify([...boxes.entries()].sort(([a], [b]) => a.localeCompare(b)))

describe('layoutGraph — ELK bố cục một lần, deterministic (Task 11)', () => {
  it('mọi node trong spec đều có box', async () => {
    for (const { id } of LESSON_LIST) {
      const spec = specFor(id)
      const boxes = await layoutGraph(spec)
      for (const n of spec.nodes) expect(boxes.has(n.id), `${id}: thiếu box cho ${n.id}`).toBe(true)
    }
  })

  it('box có width/height dương', async () => {
    for (const { id } of LESSON_LIST) {
      const spec = specFor(id)
      const boxes = await layoutGraph(spec)
      for (const n of spec.nodes) {
        const box = boxes.get(n.id)!
        expect(box.width, `${id}: ${n.id}.width`).toBeGreaterThan(0)
        expect(box.height, `${id}: ${n.id}.height`).toBeGreaterThan(0)
      }
    }
  })

  it('deterministic — hai lần chạy trên cùng spec cho toạ độ y hệt', async () => {
    for (const { id } of LESSON_LIST) {
      const spec = specFor(id)
      const first = await layoutGraph(spec)
      const second = await layoutGraph(spec)
      expect(normalize(second), id).toBe(normalize(first))
    }
  })

  it('spec rỗng trả map rỗng, không ném', async () => {
    await expect(layoutGraph({ nodes: [], edges: [] })).resolves.toEqual(new Map())
  })

  it('node compound có height LỚN HƠN NODE_H — chứng tỏ nó bọc con thật sự', async () => {
    const spec = specFor('supervisor')
    const containerIds = spec.nodes.filter(n => n.isContainer).map(n => n.id)
    // Ghim rằng fixture thật sự có node compound — nếu không thì test này vô nghĩa.
    expect(containerIds.length, 'fixture cần có node compound').toBeGreaterThan(0)

    const boxes = await layoutGraph(spec)
    for (const id of containerIds) {
      expect(boxes.get(id)!.height, id).toBeGreaterThan(NODE_H)
    }
  })

  it('toạ độ con TƯƠNG ĐỐI với cha — j3 nằm trong [0, width(j2)] của supervisor', async () => {
    const spec = specFor('supervisor')
    // Ghim hình dạng cụ thể mà test này dựa vào, thay vì đoán mù: j2 là
    // supervisorScope (container), j3 là launch đầu tiên nằm trực tiếp trong nó.
    const j2 = spec.nodes.find(n => n.id === 'j2')
    const j3 = spec.nodes.find(n => n.id === 'j3')
    expect(j2?.isContainer, 'fixture: j2 phải là container').toBe(true)
    expect(j3?.parentId, 'fixture: j3 phải là con trực tiếp của j2').toBe('j2')

    const boxes = await layoutGraph(spec)
    const j2Box = boxes.get('j2')!
    const j3Box = boxes.get('j3')!

    // Nếu ELK trả toạ độ TUYỆT ĐỐI trên canvas, j3.x sẽ vượt xa width(j2) —
    // đây chính là phép kiểm khoá chặt giả định làm React Flow khớp với ELK.
    expect(j3Box.x).toBeGreaterThanOrEqual(0)
    expect(j3Box.y).toBeGreaterThanOrEqual(0)
    expect(j3Box.x + j3Box.width).toBeLessThanOrEqual(j2Box.width)
    expect(j3Box.y + j3Box.height).toBeLessThanOrEqual(j2Box.height)
  })
})
