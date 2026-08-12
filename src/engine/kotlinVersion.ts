/**
 * Phiên bản Kotlin mà ngữ nghĩa của engine này được ĐỐI CHIẾU vào.
 *
 * Không phải "engine hỗ trợ Kotlin 2.1.20" — nó không biên dịch Kotlin, nó mô
 * phỏng một tập con. Đây là số hiệu của trình biên dịch thật mà mọi câu hỏi
 * "Kotlin làm gì ở đây?" được đem đi hỏi: fixture `expected-jvm-output.txt`
 * của từng lesson lấy từ đúng bản này, và mọi ghi chú "đã đối chiếu Kotlin
 * thật" rải trong src/engine cũng vậy.
 *
 * Một hằng số duy nhất cho cả ba nơi cần nó: script lấy fixture (dựng URL API),
 * trang giới thiệu (hiện cho người học), và test đối chiếu JVM.
 */
export const KOTLIN_VERSION = '2.1.20'

/** API của Kotlin Playground — oracle dùng để lấy output JVM thật. */
export const PLAYGROUND_API = `https://api.kotlinlang.org/api/${KOTLIN_VERSION}/compiler/run`
