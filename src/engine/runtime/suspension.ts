import type { JobId } from '../trace/events'

/**
 * `line` là dòng 1-based của biểu thức GÂY RA suspend (`delay(100)`, `j.join()`,
 * `d.await()`). Interpreter là nơi duy nhất biết được nó — scheduler chỉ thấy
 * generator đã yield ra cái gì. Optional vì `joinChildren` do builder sinh ra
 * chứ không do một dòng code nào của user.
 */
export type Suspension =
  | { s: 'delay'; ms: number; line?: number }
  | { s: 'join'; jobId: JobId; line?: number }
  | { s: 'await'; jobId: JobId; line?: number }
  /** Chờ MỌI child của jobId kết thúc. coroutineScope/supervisorScope dùng cái này. */
  | { s: 'joinChildren'; jobId: JobId; line?: number }
  | { s: 'yield'; line?: number }
  /**
   * Đổi dispatcher giữa chừng (withContext). Task được xếp lại hàng ready của
   * pool mới: thread cũ đã được release ở cuối step(), thread mới được acquire
   * ở step kế — đó là toàn bộ cơ chế "đổi thread" mà người học nhìn thấy.
   *
   * `jobId` là job sẽ đứng tên sự kiện DISPATCH: job withContext ở lượt ĐI
   * (nó là cái được dispatch sang dispatcher mới), job gọi ở lượt VỀ (lúc đó
   * job withContext đã Completed, không thể còn được dispatch đi đâu nữa).
   */
  | { s: 'switchContext'; jobId: JobId; dispatcher: string; line?: number }

/**
 * Thân coroutine: generator yield ra điểm suspend, nhận lại giá trị resume.
 *
 * Giá trị TRẢ VỀ là `unknown`, không phải `void`: thân của `async` phải mang
 * được kết quả ra ngoài để `Deferred.await()` đọc. Với `void` thì scheduler
 * không có gì để lưu, và await chỉ còn cách trả Unit — đúng cái sai âm thầm
 * mà Task 3 sửa.
 */
export type CoroutineBody = Generator<Suspension, unknown, unknown>

/**
 * Thân coroutine KHÔNG mang giá trị ra ngoài — mọi builder trừ `async`, và các
 * thân dựng tay trong test.
 *
 * Tồn tại chỉ vì TypeScript bắt hàm khai báo kiểu trả về `unknown` phải có
 * `return` tường minh; viết `return undefined` ở cuối vài chục generator vốn
 * không trả gì là nhiễu chứ không phải thông tin. Về mặt gán thì nó vẫn là một
 * `CoroutineBody` hợp lệ, nên scheduler không cần biết tới nó.
 */
export type VoidCoroutineBody = Generator<Suspension, void, unknown>
