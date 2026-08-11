/**
 * Memo một-ô, so sánh tham chiếu theo từng đối số.
 *
 * Không phải để làm foldTrace nhanh hơn — đã đo, gập cả trace 16k event tốn
 * 0.49ms, tức 3% một khung hình 60fps. Lý do thật là ỔN ĐỊNH THAM CHIẾU:
 * foldTrace trả object MỚI mỗi lần gọi, nên gọi thẳng trong selector sẽ khiến
 * mọi component re-render ở mọi lần store đổi, kể cả khi stepIndex không đổi.
 */
export function memoizeTwo<A, B, R>(fn: (a: A, b: B) => R): (a: A, b: B) => R {
  let lastA: A | undefined
  let lastB: B | undefined
  let last: R | undefined
  let has = false
  return (a, b) => {
    if (has && lastA === a && lastB === b) return last as R
    lastA = a; lastB = b; last = fn(a, b); has = true
    return last
  }
}
