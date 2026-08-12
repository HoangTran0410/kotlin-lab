import type { Event, JobId } from '../trace/events'
import { jobLabel } from '../trace/label'
import type { WorldState } from '../trace/world'

/**
 * Một event thành MỘT câu tiếng Việt. Hàm thuần.
 *
 * `before` là thế giới NGAY TRƯỚC khi áp `event` — cần thế để câu nói được về
 * trạng thái vừa rời đi ("đang chờ", "vẫn còn sống"), và để tra tên những job
 * đã tồn tại.
 *
 * Trả `null` nghĩa là event này không đáng một câu (hạ tầng thuần tuý như
 * THREAD_STATE). Trả chuỗi rỗng thì KHÔNG bao giờ hợp lệ — người đọc sẽ thấy
 * một dòng trắng và không biết là lỗi hay là có ý.
 *
 * Vì suy hết từ dữ liệu có cấu trúc nên code do người học tự viết cũng có diễn
 * giải, không cần ai viết tay từng bước như bản HTML cũ.
 *
 * Quy ước: mọi định danh (tên job, thread, kiểu exception) bọc trong dấu
 * backtick. Tầng hiển thị tách theo backtick để in bằng font mã — xem
 * NarrationPanel.
 */
export function narrate(event: Event, before: WorldState): string | null {
  const e = event
  /** Tên job đã có trong thế giới; job chưa từng thấy thì trả chính id. */
  const at = (id: JobId): string => {
    const j = before.jobs.get(id)
    return j ? jobLabel(j) : id
  }

  switch (e.k) {
    case 'COROUTINE_CREATED': {
      const self = jobLabel({ id: e.id, builder: e.builder, name: e.ctx.name })
      const nơi = e.ctx.dispatcher ? ` (dispatcher \`${e.ctx.dispatcher}\`)` : ''
      if (e.parentId === null) {
        return e.builder === 'scope'
          ? `\`${self}\` được tạo — một scope GỐC, không có cha. Nó không nằm dưới coroutine nào, nên không ai chờ nó và không ai huỷ nó thay bạn.`
          : `\`${self}\` được tạo — gốc của cây job${nơi}.`
      }
      const sup = e.ctx.isSupervisor
        ? ' Đây là ranh giới supervisor: failure của con TRỰC TIẾP sẽ dừng lại ở đây.'
        : ''
      return `\`${self}\` được tạo dưới \`${at(e.parentId)}\`${nơi}.${sup}`
    }

    case 'COROUTINE_STARTED':
      return `\`${at(e.id)}\` bắt đầu chạy trên thread \`${e.threadId}\`.`

    case 'COROUTINE_RESUMED':
      return `\`${at(e.id)}\` chạy tiếp trên thread \`${e.threadId}\` — tiếp đúng chỗ đã dừng, không chạy lại từ đầu.`

    case 'COROUTINE_SUSPENDED': {
      const ai = at(e.id)
      const thread = before.jobs.get(e.id)?.threadId
      const trả = thread ? ` Thread \`${thread}\` được TRẢ về pool` : ' Thread được TRẢ về pool'
      switch (e.reason) {
        case 'delay':
          return `\`${ai}\` gặp \`delay\` và dừng lại.${trả} — không bị chặn, coroutine khác dùng được ngay.`
        case 'join':
          // Cố ý KHÔNG nói "chờ coroutine khác": ở tầng Event, `join()` do người
          // học gọi và `joinChildren` mà scope tự phát ra khi kết thúc thân mình
          // đều mang reason 'join' — không phân biệt được. `runBlocking` ở cuối
          // chương trình đang chờ CON CỦA CHÍNH NÓ, nên câu "chờ coroutine khác"
          // sẽ là một lời nói dối nhỏ đúng ở chỗ người học dễ hiểu sai nhất.
          return `\`${ai}\` dừng lại chờ (\`join\`).${trả} trong lúc chờ.`
        case 'await':
          return `\`${ai}\` chờ kết quả của \`Deferred\` (\`await\`).${trả} trong lúc chờ.`
        case 'yield':
          return `\`${ai}\` nhường lượt cho coroutine khác (\`yield\`).`
        default:
          return `\`${ai}\` tạm dừng (\`${e.reason}\`).${trả} trong lúc chờ.`
      }
    }

    case 'JOB_STATE': {
      const ai = at(e.id)
      if (e.to === 'Completed') return `\`${ai}\` hoàn tất bình thường.`
      if (e.to === 'Cancelling') {
        return e.cause
          ? `\`${ai}\` bắt đầu huỷ, nguyên nhân \`${e.cause}\`.`
          : `\`${ai}\` bắt đầu huỷ.`
      }
      if (e.to === 'Cancelled') return `\`${ai}\` đã huỷ xong.`
      // New→Active và Active→Completing là bước chuyển nội bộ, không mang thông
      // tin nào người học cần — để chúng sinh câu sẽ nhấn chìm những câu đáng đọc.
      return null
    }

    case 'EXCEPTION_THROWN':
      return `\`${at(e.id)}\` ném \`${e.exType}\`${e.message ? `: "${e.message}"` : ''}.`

    case 'EXCEPTION_CAUGHT':
      return `\`${at(e.id)}\` BẮT ĐƯỢC \`${e.exType}\` — exception đã được xử lý, nên job này KHÔNG fail.`

    case 'FAILURE_PROPAGATED': {
      const con = at(e.from)
      const cha = at(e.to)
      return e.blockedBySupervisor
        ? `\`${con}\` kết thúc bất thường, nhưng \`${cha}\` là supervisor — failure DỪNG tại đây. Anh em của \`${con}\` không bị ảnh hưởng.`
        : `\`${con}\` kết thúc bất thường. \`${cha}\` là Job thường (không phải supervisor), nên failure lan LÊN \`${cha}\` — và kéo theo mọi con còn lại của nó.`
    }

    case 'CANCEL_REQUESTED':
      return e.from === 'user'
        ? `Code gọi \`cancel()\` trên \`${at(e.to)}\` (nguyên nhân \`${e.cause}\`).`
        : `\`${at(e.from)}\` huỷ \`${at(e.to)}\` — cancel luôn đi XUỐNG, tới hết cây con.`

    case 'HANDLER_RECEIVED':
      return `Handler \`${e.handler}\` nhận \`${e.exType}\` — đây là chặng cuối, không còn ai ở trên để lan tiếp.`

    case 'DISPATCH':
      return `\`${at(e.id)}\` chuyển sang dispatcher \`${e.dispatcher}\`, thread \`${e.threadId}\` — vẫn là cùng một coroutine, chỉ đổi thread.`

    case 'PRINTLN':
      return `\`${at(e.id)}\` in ra: "${e.text}"`

    // Hạ tầng thuần tuý: đã hiện trên đồ thị/timeline, thành câu thì chỉ gây nhiễu.
    case 'THREAD_STATE':
      return null

    default:
      return null
  }
}
