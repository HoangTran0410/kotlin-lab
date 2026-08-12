import { useCallback, useEffect, useState } from 'react'

export const MIN_LEFT = 260
export const MAX_LEFT = 900
export const MIN_RIGHT = 280
export const MAX_RIGHT = 800

const KHOA = 'kcl.panels.v1'

interface BeRong { left: number; right: number }

/** Rộng hơn hẳn mức cũ (320px): cột code chật là thứ người dùng phàn nàn đầu tiên. */
const MAC_DINH: BeRong = { left: 460, right: 400 }

function doc(): BeRong {
  // localStorage là dữ liệu ngoài tầm kiểm soát: người dùng sửa tay, phiên bản
  // cũ ghi định dạng khác, chế độ riêng tư ném khi đọc. Hỏng thì về mặc định,
  // không được làm trắng màn hình vì một con số bề rộng.
  try {
    const raw = localStorage.getItem(KHOA)
    if (!raw) return MAC_DINH
    const v = JSON.parse(raw) as Partial<BeRong>
    const so = (x: unknown, mac: number, min: number, max: number): number =>
      typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : mac
    return {
      left: so(v.left, MAC_DINH.left, MIN_LEFT, MAX_LEFT),
      right: so(v.right, MAC_DINH.right, MIN_RIGHT, MAX_RIGHT),
    }
  } catch {
    return MAC_DINH
  }
}

/**
 * Bề rộng hai cột hai bên, kéo được và nhớ qua lần mở sau.
 *
 * Trước đây bề rộng là hằng số trong CSS, nên cột code luôn chật đúng một mức
 * dù màn hình rộng bao nhiêu và dù người học đang đọc code dài hay ngắn.
 */
export function usePanelWidths() {
  const [beRong, setBeRong] = useState<BeRong>(doc)

  useEffect(() => {
    try { localStorage.setItem(KHOA, JSON.stringify(beRong)) } catch { /* chế độ riêng tư: bỏ qua */ }
  }, [beRong])

  const setLeft = useCallback((w: number) => setBeRong(v => ({ ...v, left: w })), [])
  const setRight = useCallback((w: number) => setBeRong(v => ({ ...v, right: w })), [])
  const reset = useCallback(() => setBeRong(MAC_DINH), [])

  return { left: beRong.left, right: beRong.right, setLeft, setRight, reset }
}
