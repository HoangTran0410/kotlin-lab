# Nội dung 9 kịch bản của bản HTML gốc

Trích nguyên văn từ `kotlin_coroutines_visual_lab.html` để làm nguồn cho lesson mới.
Không sửa câu chữ. Mỗi mục dưới đây là nội dung dạy học cần được bảo toàn.

## 1. `suspend` — suspend / resume — Coroutine dừng, Job vẫn ACTIVE

**Nav:** Suspend / Resume
**Phụ đề:** Tách execution state của coroutine khỏi lifecycle state của Job.
**Mô tả:** Coroutine vs Job lifecycle
**Khái niệm:** <p><b>suspend</b> là execution state của coroutine, không phải lifecycle state của Job.</p><ul><li>Coroutine có thể <b>SUSPENDED</b> trong khi Job vẫn <b>ACTIVE</b>.</li><li>Continuation giữ vị trí/state cần resume.</li><li>Thread được trả về pool, không ngồi chờ.</li></ul>

### Code
```kotlin
val job = scope.launch {
    println("A")
    delay(1000) // coroutine SUSPENDED
    println("B") // RESUME
}
// Trong lúc delay, job.isActive vẫn có thể là true
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| co | Coroutine A | coroutine | trạng thái ban đầu: RUNNING; chi tiết: execution state; vị trí: x=85, y=195, w=170 |
| job | Job A | job | trạng thái ban đầu: ACTIVE; chi tiết: lifecycle state; vị trí: x=85, y=335, w=170 |
| cont | Continuation | continuation | trạng thái ban đầu: IDLE; chi tiết: state machine; vị trí: x=380, y=195, w=170 |
| disp | Dispatcher.Default | dispatcher | trạng thái ban đầu: READY; chi tiết: scheduler; vị trí: x=680, y=115, w=175 |
| t1 | Thread #1 | thread | trạng thái ban đầu: RUNNING; chi tiết: CPU worker; vị trí: x=680, y=325, w=155 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| co | job | owns lifecycle |
| co | cont | suspend state |
| disp | t1 | schedule |

### Các bước diễn giải
1. Coroutine A đang execute trên Thread #1. — (op: focus, target: co)
2. Gặp delay(1000) → execution của Coroutine A chuyển sang SUSPENDED. — (op: status, target: co, status: SUSPENDED)
3. Job A vẫn ACTIVE. Suspend không đồng nghĩa Job bị stop/cancel. — (op: focus, target: job)
4. Continuation lưu state để biết sẽ chạy tiếp từ đâu. — (op: status, target: cont, status: STORED)
5. Thread #1 được release về pool — không bị block 1 giây. — (op: status, target: t1, status: FREE)
6. Timer/event hoàn tất → continuation sẵn sàng resume. — (op: status, target: cont, status: READY)
7. Dispatcher nhận continuation ready và chọn worker. — (op: status, target: disp, status: SCHEDULING)
8. Dispatcher schedule continuation lên Thread #1. — (op: travel, target: disp → t1, token: resume, label: RESUME)
9. Thread #1 bắt đầu execute coroutine trở lại. — (op: status, target: t1, status: RUNNING)
10. Coroutine A RESUME và tiếp tục từ sau delay(). — (op: status, target: co, status: RUNNING)
11. Coroutine chạy xong. — (op: status, target: co, status: COMPLETED)
12. Job A chuyển COMPLETED khi coroutine và children hoàn tất. — (op: status, target: job, status: COMPLETED)

## 2. `jobtree` — Structured concurrency — cây Job quản lifecycle

**Nav:** Job Tree
**Phụ đề:** Parent bị cancel thì cancellation đi xuống toàn bộ children.
**Mô tả:** Parent → children cancellation
**Khái niệm:** <p><b>Job</b> là lifecycle + quan hệ parent/child của coroutine.</p><ul><li>Parent cancel → children cancel.</li><li>Cancellation đi <b>xuống</b> cây.</li><li>Failure của child có thể đi <b>lên</b> cây nếu parent là Job bình thường.</li></ul>

### Code
```kotlin
val parent = scope.launch {
    launch { /* A */ }
    launch { /* B */ }
    launch { /* C */ }
}
parent.cancel()
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| p | Parent Job | job | trạng thái ban đầu: ACTIVE; chi tiết: parent; vị trí: x=405, y=85, w=175 |
| a | Child A | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=115, y=310, w=155 |
| b | Child B | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=420, y=310, w=155 |
| c | Child C | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=725, y=310, w=155 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| p | a | parent → child |
| p | b | parent → child |
| p | c | parent → child |

### Các bước diễn giải
1. Parent Job đang ACTIVE và quản 3 child Job. — (op: focus, target: p)
2. parent.cancel() → cancellation đi xuống Child A. — (op: travel, target: p → a, token: cancel, label: CANCEL)
3. Child A → CANCELLED. — (op: status, target: a, status: CANCELLED)
4. Cancellation đi xuống Child B. — (op: travel, target: p → b, token: cancel, label: CANCEL)
5. Child B → CANCELLED. — (op: status, target: b, status: CANCELLED)
6. Cancellation đi xuống Child C. — (op: travel, target: p → c, token: cancel, label: CANCEL)
7. Child C → CANCELLED. — (op: status, target: c, status: CANCELLED)
8. Parent Job kết thúc ở trạng thái CANCELLED. — (op: status, target: p, status: CANCELLED)

## 3. `exception` — Exception ≠ Failure

**Nav:** Exception → Failure
**Phụ đề:** Exception là thứ được throw; failure là việc Job kết thúc bất thường.
**Mô tả:** Lỗi trong code vs trạng thái Job
**Khái niệm:** <p><b>Exception</b> là object/tín hiệu lỗi được <code>throw</code>. <b>Failure</b> là kết quả lifecycle khi Job chết vì exception không được xử lý.</p><p>Nếu exception được <code>catch</code> và coroutine chạy tiếp, có exception nhưng <b>không có Job failure</b>.</p>

### Code
```kotlin
scope.launch {
    throw IOException("boom")
}
// IOException = exception
// Job kết thúc bất thường = failure
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| co | Coroutine B | coroutine | trạng thái ban đầu: RUNNING; chi tiết: executing code; vị trí: x=95, y=230, w=175 |
| ex | IOException("boom") | exception | trạng thái ban đầu: IDLE; chi tiết: exception object; vị trí: x=405, y=230, w=190 |
| job | Job B | job | trạng thái ban đầu: ACTIVE; chi tiết: lifecycle; vị trí: x=730, y=230, w=160 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| co | ex | throw |
| ex | job | uncaught → fail |

### Các bước diễn giải
1. Coroutine B đang chạy bình thường; Job B vẫn ACTIVE. — (op: focus, target: co)
2. Code throw IOException("boom") → một exception object xuất hiện. — (op: travel, target: co → ex, token: exception, label: EXCEPTION)
3. Exception đang unwind call stack để tìm catch. — (op: status, target: ex, status: THROWN)
4. Không có catch phù hợp → exception thoát khỏi coroutine body. — (op: status, target: ex, status: UNHANDLED)
5. Coroutine kết thúc bất thường. — (op: status, target: co, status: FAILED)
6. Visualizer dùng token FAILURE để biểu diễn trạng thái lỗi làm Job B fail; đây không phải một exception object mới. — (op: travel, target: co → job, token: failure, label: FAILURE)
7. Job B → FAILED. Đây chính là failure. — (op: status, target: job, status: FAILED)

## 4. `normalfail` — Normal Job — child fail → parent fail → siblings cancel

**Nav:** Normal Job Failure
**Phụ đề:** Failure đi lên; cancellation quay xuống.
**Mô tả:** Child fail kéo siblings xuống
**Khái niệm:** <p>Với <b>Job bình thường</b>, unhandled exception của một child làm child <b>FAILED</b>. Failure propagate lên parent; parent fail rồi cancel các sibling còn lại.</p>

### Code
```kotlin
coroutineScope {
    launch { A() }
    launch { error("boom") } // B
    launch { C() }
}
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| p | Parent Job | job | trạng thái ban đầu: ACTIVE; chi tiết: normal parent; vị trí: x=410, y=80, w=175 |
| a | Child A | job | trạng thái ban đầu: ACTIVE; chi tiết: sibling; vị trí: x=105, y=300, w=155 |
| b | Child B | job | trạng thái ban đầu: ACTIVE; chi tiết: will fail; vị trí: x=420, y=300, w=155 |
| c | Child C | job | trạng thái ban đầu: ACTIVE; chi tiết: sibling; vị trí: x=735, y=300, w=155 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| p | a |  |
| p | b |  |
| p | c |  |

### Các bước diễn giải
1. Child B gặp unhandled exception → B FAILED. — (op: status, target: b, status: FAILED)
2. Failure của B propagate lên normal Parent Job. — (op: travel, target: b → p, token: failure, label: FAILURE ↑)
3. Parent Job → FAILED. — (op: status, target: p, status: FAILED)
4. Parent failure phát cancellation xuống sibling A. — (op: travel, target: p → a, token: cancel, label: CANCEL ↓)
5. Child A → CANCELLED. — (op: status, target: a, status: CANCELLED)
6. Cancellation tiếp tục xuống sibling C. — (op: travel, target: p → c, token: cancel, label: CANCEL ↓)
7. Child C → CANCELLED. — (op: status, target: c, status: CANCELLED)

## 5. `supervisor` — SupervisorJob — firewall cho child failure

**Nav:** SupervisorJob
**Phụ đề:** Sibling sống tiếp, nhưng exception chưa tự biến mất.
**Mô tả:** Chặn failure, không catch exception
**Khái niệm:** <p><b>SupervisorJob không catch exception.</b> Nó chỉ chặn việc child failure làm supervisor fail và cancel siblings.</p><ul><li>B FAILED.</li><li>Supervisor vẫn ACTIVE.</li><li>A/C vẫn ACTIVE.</li><li>Unhandled exception của <code>launch</code> vẫn đi tới exception handling.</li></ul>

### Code
```kotlin
val scope = CoroutineScope(
    SupervisorJob() + Dispatchers.Main
)

scope.launch { error("boom") }
scope.launch { /* vẫn sống */ }
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| p | SupervisorJob | job | trạng thái ban đầu: ACTIVE; chi tiết: supervisor parent; vị trí: x=410, y=75, w=180 |
| a | Child A | job | trạng thái ban đầu: ACTIVE; chi tiết: sibling; vị trí: x=95, y=285, w=155 |
| b | Child B | job | trạng thái ban đầu: ACTIVE; chi tiết: will fail; vị trí: x=420, y=285, w=155 |
| c | Child C | job | trạng thái ban đầu: ACTIVE; chi tiết: sibling; vị trí: x=745, y=285, w=155 |
| h | Exception Handler | handler | trạng thái ban đầu: WAITING; chi tiết: CEH / platform; vị trí: x=420, y=430, w=180 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| p | a |  |
| p | b |  |
| p | c |  |
| b | h | uncaught exception |

### Các bước diễn giải
1. Child B gặp unhandled exception → FAILED. — (op: status, target: b, status: FAILED)
2. Failure chạy lên Supervisor boundary và bị chặn. — (op: block, target: b → p, token: failure, label: FAILURE)
3. SupervisorJob vẫn ACTIVE — nó không fail vì direct child B fail. — (op: focus, target: p)
4. Child A vẫn ACTIVE. — (op: focus, target: a)
5. Child C vẫn ACTIVE. — (op: focus, target: c)
6. Nhưng exception object chưa được catch → đi tới CoroutineExceptionHandler / platform handler. — (op: travel, target: b → h, token: exception, label: EXCEPTION)
7. Handler/platform nhận uncaught exception. Supervisor không hề “nuốt” nó. — (op: status, target: h, status: RECEIVED)

## 6. `launchasync` — launch vs async — cùng fail, nhưng cách nhận exception khác nhau

**Nav:** launch vs async
**Phụ đề:** launch dùng uncaught handling; async giữ failure/result trong Deferred để await().
**Mô tả:** Exception được quan sát khác nhau
**Khái niệm:** <p><code>launch</code> trả về <b>Job</b>; root-like unhandled exception đi vào uncaught exception handling.</p><p><code>async</code> trả về <b>Deferred&lt;T&gt;</b>; failure/result được quan sát bằng <code>await()</code>. Điều này <b>không xóa parent-child failure propagation</b> của async.</p>

### Code
```kotlin
scope.launch {
    error("boom")
}

val d = scope.async {
    error("boom")
}
try { d.await() } catch (e: Exception) { }
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| la | launch | coroutine | trạng thái ban đầu: RUNNING; chi tiết: returns Job; vị trí: x=85, y=125, w=160 |
| lj | launch Job | job | trạng thái ban đầu: ACTIVE; chi tiết: lifecycle; vị trí: x=85, y=295, w=160 |
| lh | Unhandled Handler | handler | trạng thái ban đầu: WAITING; chi tiết: CEH / platform; vị trí: x=85, y=430, w=175 |
| as | async | coroutine | trạng thái ban đầu: RUNNING; chi tiết: returns Deferred; vị trí: x=555, y=125, w=160 |
| df | Deferred<T> | deferred | trạng thái ban đầu: PENDING; chi tiết: result/failure; vị trí: x=555, y=295, w=170 |
| aw | await() | await | trạng thái ban đầu: WAITING; chi tiết: caller; vị trí: x=790, y=295, w=130 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| la | lj | owns Job |
| lj | lh | uncaught |
| as | df | completes Deferred |
| df | aw | await |

### Các bước diễn giải
1. launch body throw unhandled exception → coroutine FAILED. — (op: status, target: la, status: FAILED)
2. Job của launch → FAILED. — (op: status, target: lj, status: FAILED)
3. Unhandled exception của launch đi vào uncaught handling. — (op: travel, target: lj → lh, token: exception, label: EXCEPTION)
4. Handler/platform nhận exception. — (op: status, target: lh, status: RECEIVED)
5. async body cũng có thể FAILED. — (op: status, target: as, status: FAILED)
6. Deferred hoàn thành với failure. — (op: status, target: df, status: FAILED)
7. Caller gọi await(). — (op: focus, target: aw)
8. await() rethrow exception tại chính điểm await(). — (op: travel, target: df → aw, token: exception, label: RETHROW)
9. Exception xuất hiện ở caller của await(); caller có thể try/catch tại đây. — (op: status, target: aw, status: RETHROW)

## 7. `dispatcher` — CoroutineContext — Job quản lifecycle, Dispatcher quản scheduling

**Nav:** Context / Dispatcher
**Phụ đề:** Coroutine không bị “gắn chết” vào một thread.
**Mô tả:** Lifecycle khác scheduling
**Khái niệm:** <p><b>CoroutineContext</b> là tập element: Job, Dispatcher, CoroutineName, CoroutineExceptionHandler...</p><p><b>Job</b> quyết định lifecycle/failure tree. <b>Dispatcher</b> chỉ quyết định continuation được execute ở thread nào.</p>

### Code
```kotlin
val scope = CoroutineScope(
    SupervisorJob() +
    Dispatchers.IO +
    CoroutineName("worker")
)

scope.launch { /* ... */ }
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| scope | CoroutineScope | scope | trạng thái ban đầu: READY; chi tiết: launch {...}; vị trí: x=70, y=225, w=160 |
| ctx | CoroutineContext | context | trạng thái ban đầu: READY; chi tiết: Job + Dispatcher + ...; vị trí: x=300, y=225, w=175 |
| job | Job | job | trạng thái ban đầu: ACTIVE; chi tiết: lifecycle; vị trí: x=545, y=115, w=145 |
| disp | Dispatcher.IO | dispatcher | trạng thái ban đầu: READY; chi tiết: scheduler; vị trí: x=545, y=330, w=160 |
| t1 | Thread #7 | thread | trạng thái ban đầu: RUNNING; chi tiết: worker; vị trí: x=805, y=145, w=135 |
| t2 | Thread #12 | thread | trạng thái ban đầu: FREE; chi tiết: worker; vị trí: x=805, y=345, w=135 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| scope | ctx | uses context |
| ctx | job | element |
| ctx | disp | element |
| disp | t1 | schedule |
| disp | t2 | resume |

### Các bước diễn giải
1. CoroutineScope gọi launch(). — (op: focus, target: scope)
2. Coroutine nhận CoroutineContext từ scope và context override. — (op: focus, target: ctx)
3. Job element chịu trách nhiệm lifecycle + parent/child. — (op: focus, target: job)
4. Dispatcher nhận continuation cần chạy. — (op: status, target: disp, status: SCHEDULING)
5. Dispatcher schedule lên Thread #7. — (op: travel, target: disp → t1, token: resume, label: RUN)
6. Coroutine suspend → Thread #7 được release. — (op: status, target: t1, status: FREE)
7. Khi resume, Dispatcher có thể chọn Thread #12. — (op: travel, target: disp → t2, token: resume, label: RESUME)
8. Coroutine tiếp tục trên Thread #12. Nó không “thuộc” cố định Thread #7. — (op: status, target: t2, status: RUNNING)
9. Dù đổi thread, Job lifecycle vẫn là cùng một Job. — (op: focus, target: job)

## 8. `scopecompare` — coroutineScope vs supervisorScope

**Nav:** coroutineScope vs supervisorScope
**Phụ đề:** Cùng chờ children; khác cách child failure tác động siblings.
**Mô tả:** Fail-fast vs independent children
**Khái niệm:** <p><code>coroutineScope</code>: child failure propagate lên scope → scope fail → siblings cancel.</p><p><code>supervisorScope</code>: direct child failure bị cô lập → siblings không tự bị cancel.</p>

### Code
```kotlin
coroutineScope {
    launch { A() }
    launch { B() } // fail => A cancel
}

supervisorScope {
    launch { A() }
    launch { B() } // fail => A vẫn sống
}
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| cs | coroutineScope | scope | trạng thái ban đầu: ACTIVE; chi tiết: normal parent; vị trí: x=90, y=95, w=190 |
| ca | A | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=55, y=315, w=135 |
| cb | B | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=220, y=315, w=135 |
| ss | supervisorScope | scope | trạng thái ban đầu: ACTIVE; chi tiết: supervisor parent; vị trí: x=620, y=95, w=195 |
| sa | A | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=585, y=315, w=135 |
| sb | B | job | trạng thái ban đầu: ACTIVE; chi tiết: child; vị trí: x=750, y=315, w=135 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| cs | ca |  |
| cs | cb |  |
| ss | sa |  |
| ss | sb |  |

### Các bước diễn giải
1. B bên coroutineScope → FAILED. — (op: status, target: cb, status: FAILED)
2. Failure propagate lên coroutineScope. — (op: travel, target: cb → cs, token: failure, label: FAILURE)
3. coroutineScope → FAILED. — (op: status, target: cs, status: FAILED)
4. Scope fail → sibling A bị cancel. — (op: travel, target: cs → ca, token: cancel, label: CANCEL)
5. A bên coroutineScope → CANCELLED. — (op: status, target: ca, status: CANCELLED)
6. B bên supervisorScope → FAILED. — (op: status, target: sb, status: FAILED)
7. Failure chạy tới supervisorScope boundary và bị chặn. — (op: block, target: sb → ss, token: failure, label: FAILURE)
8. supervisorScope vẫn ACTIVE. — (op: focus, target: ss)
9. A bên supervisorScope vẫn ACTIVE. — (op: focus, target: sa)

## 9. `nestedtrap` — Bẫy: Supervisor ở root không làm mọi descendant độc lập

**Nav:** Nested Supervisor Trap
**Phụ đề:** Normal Job ở giữa vẫn tạo một fail-fast subtree.
**Mô tả:** Supervisor chỉ supervise direct child
**Khái niệm:** <p>Supervisor chỉ thay đổi cách <b>direct child failure</b> tác động parent. Nếu direct child P là normal Job, thì A/B/C ở dưới P vẫn tuân rule normal Job.</p><p>Muốn A/B/C độc lập: đặt trực tiếp dưới supervisor hoặc bọc chúng trong <code>supervisorScope</code>.</p>

### Code
```kotlin
val scope = CoroutineScope(SupervisorJob())

scope.launch { // P = normal Job
    launch { A() }
    launch { error("B") }
    launch { C() }
}

// Muốn A/B/C độc lập:
scope.launch {
    supervisorScope {
        launch { A() }
        launch { B() }
        launch { C() }
    }
}
```

### Node
| id | label | kind | ghi chú khác |
|---|---|---|---|
| root | SupervisorJob | job | trạng thái ban đầu: ACTIVE; chi tiết: root; vị trí: x=410, y=55, w=180 |
| p | launch P | job | trạng thái ban đầu: ACTIVE; chi tiết: normal Job; vị trí: x=415, y=205, w=170 |
| a | A | job | trạng thái ban đầu: ACTIVE; chi tiết: child of P; vị trí: x=110, y=390, w=150 |
| b | B | job | trạng thái ban đầu: ACTIVE; chi tiết: child of P; vị trí: x=425, y=390, w=150 |
| c | C | job | trạng thái ban đầu: ACTIVE; chi tiết: child of P; vị trí: x=740, y=390, w=150 |

### Cạnh
| from | to | nhãn/kiểu |
|---|---|---|
| root | p | direct child |
| p | a |  |
| p | b |  |
| p | c |  |

### Các bước diễn giải
1. Root scope dùng SupervisorJob. — (op: focus, target: root)
2. scope.launch tạo direct child P. P là một normal Job. — (op: focus, target: p)
3. B là child của P, không phải direct child của Supervisor. — (op: focus, target: b)
4. B → FAILED. — (op: status, target: b, status: FAILED)
5. Failure của B propagate lên normal parent P. — (op: travel, target: b → p, token: failure, label: FAILURE)
6. P → FAILED. — (op: status, target: p, status: FAILED)
7. P fail → cancellation xuống sibling A. — (op: travel, target: p → a, token: cancel, label: CANCEL)
8. A → CANCELLED. — (op: status, target: a, status: CANCELLED)
9. Cancellation xuống sibling C. — (op: travel, target: p → c, token: cancel, label: CANCEL)
10. C → CANCELLED. — (op: status, target: c, status: CANCELLED)
11. Failure của direct child P bị SupervisorJob ở root cô lập. — (op: block, target: p → root, token: failure, label: FAILURE)
12. Root SupervisorJob vẫn ACTIVE, nhưng subtree của P đã chết. — (op: focus, target: root)
