import { create } from 'zustand'
import { compile, EMPTY_COMPILED, type Compiled } from './compile'
import { lessonSource, LESSON_LIST } from '../lessons/registry'

interface LabState {
  source: string
  compiled: Compiled
  stepIndex: number
  lessonId: string | null

  setSource: (src: string) => void
  setStep: (n: number) => void
  loadLesson: (id: string) => void
  /** Nạp một đoạn mã KHÔNG thuộc bài nào (trang trắng, ví dụ trong trang giới thiệu). */
  loadSource: (src: string) => void
}

const clampStep = (n: number, len: number): number => Math.max(0, Math.min(n, len))

/**
 * Store giữ ĐÚNG BA thứ không suy ra được: source (user gõ), compiled (kết quả
 * của một hàm thuần trên source, ở đây vì compile theo debounce chứ không trong
 * render), stepIndex (con trỏ của user).
 *
 * KHÔNG được thêm WorldState, danh sách node, dòng console hay dòng highlight
 * vào đây. Chúng đều là hàm thuần của ba trường trên; giữ bản sao là dựng mô
 * hình state song song với trace — thứ chắc chắn trôi lệch khi tua ngược.
 */
export const useLabStore = create<LabState>((set, get) => ({
  source: '',
  compiled: EMPTY_COMPILED,
  stepIndex: 0,
  lessonId: null,

  setSource: src => {
    const compiled = compile(src)
    // Trace mới thì con trỏ cũ có thể trỏ ra ngoài. Kẹp thay vì về 0: khi user
    // sửa một dòng ở giữa, họ muốn ở lại gần chỗ đang xem.
    set({ source: src, compiled, stepIndex: clampStep(get().stepIndex, compiled.events.length) })
  },

  setStep: n => set({ stepIndex: clampStep(n, get().compiled.events.length) }),

  loadLesson: id => {
    const src = lessonSource(id)
    if (src === null) return
    set({ source: src, compiled: compile(src), stepIndex: 0, lessonId: id })
  },

  // Khác `setSource` ở hai chỗ, và cả hai đều cần: XOÁ lessonId (nếu không,
  // "Bắt đầu từ trang trắng" và "Mở ví dụ" để lại chip bài cũ sáng trên nav
  // trong khi editor đã là mã khác hẳn), và ĐƯA con trỏ về 0 (kẹp con trỏ cũ
  // như setSource là đúng khi đang gõ dở, nhưng nhảy vào giữa một chương trình
  // vừa mở thì vô nghĩa).
  loadSource: src => set({ source: src, compiled: compile(src), stepIndex: 0, lessonId: null }),
}))

export { LESSON_LIST }
