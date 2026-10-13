# Hướng dẫn đọc source Codex CLI

Tài liệu này bóc kiến trúc Codex CLI theo **luồng chạy thật**, thay vì liệt kê thư mục. Mục tiêu là giúp người mới lần được một request từ frontend tới model, tool, sandbox, persistence và test harness.

## Mục lục

1. [Bức tranh tổng thể](#1-bức-tranh-tổng-thể)
2. [Thuật ngữ cốt lõi](#2-thuật-ngữ-cốt-lõi)
3. [Entrypoint và các frontend](#3-entrypoint-và-các-frontend)
4. [Core API và production harness](#4-core-api-và-production-harness)
5. [Protocol nội bộ: Op và EventMsg](#5-protocol-nội-bộ-op-và-eventmsg)
6. [Session runtime và state machine](#6-session-runtime-và-state-machine)
7. [Start turn và steering](#7-start-turn-và-steering)
8. [Một turn chạy như thế nào](#8-một-turn-chạy-như-thế-nào)
9. [TurnContext và StepContext](#9-turncontext-và-stepcontext)
10. [Context và world state](#10-context-và-world-state)
11. [Tool architecture](#11-tool-architecture)
12. [Approval, exec policy và sandbox](#12-approval-exec-policy-và-sandbox)
13. [Persistence, rollout, resume và fork](#13-persistence-rollout-resume-và-fork)
14. [App-server và public API](#14-app-server-và-public-api)
15. [MCP, plugin, skill và extension](#15-mcp-plugin-skill-và-extension)
16. [Test harness](#16-test-harness)
17. [Các invariant quan trọng](#17-các-invariant-quan-trọng)
18. [Contributor workflow và rule](#18-contributor-workflow-và-rule)
19. [Hướng phát triển coding-agent harness riêng](#19-hướng-phát-triển-coding-agent-harness-riêng)
20. [Lộ trình đọc source](#20-lộ-trình-đọc-source)
21. [Bài tập thực hành](#21-bài-tập-thực-hành)
22. [Bản đồ file tra cứu nhanh](#22-bản-đồ-file-tra-cứu-nhanh)

## 1. Bức tranh tổng thể

Codex CLI là một **event-driven agent runtime**. Nhiều frontend cùng sử dụng một agent engine ở `codex-core`.

```text
CLI / TUI / IDE / Desktop / MCP / codex exec
                    │
                    ▼
      App-server JSON-RPC hoặc Core API
                    │
                    ▼
        ThreadManager → CodexThread
                    │
              Submission<Op>
                    │
                    ▼
          Session submission_loop
                    │
                    ▼
          Turn Task → run_turn()
                    │
       ┌────────────┴────────────┐
       ▼                         ▼
 Build model context       Build tool registry
       │                         │
       └───────────┬─────────────┘
                   ▼
             Responses API
                   │
        assistant text / tool call
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   Finish turn        ToolRouter dispatch
                             │
                    approval + sandbox
                             │
                       execute tool
                             │
                  tool output vào history
                             │
                    gọi model lần tiếp
```

Bốn luồng dữ liệu quan trọng:

1. **Command bus:** frontend gửi `Submission { id, op }` vào core.
2. **Event bus:** core trả `Event { id, msg }` cho frontend.
3. **Model stream:** backend model gửi `ResponseEvent` qua SSE hoặc WebSocket.
4. **Persistence stream:** session append `RolloutItem` vào rollout JSONL.

Mental model ngắn nhất:

```text
Frontend gửi Op
Session biến Op thành task
Task chạy model loop
Model có thể gọi tool
Tool đi qua policy và sandbox
Kết quả tool quay lại model
Core phát Event và ghi Rollout
```

## 2. Thuật ngữ cốt lõi

### Thread

Thread là một cuộc hội thoại bền vững, có thể resume, fork, archive và tìm lại. Public handle là `CodexThread` tại `codex-rs/core/src/codex_thread.rs:210`.

```rust
pub struct CodexThread {
    pub(crate) session: Arc<Session>,
    pub(crate) io: SessionIo,
    // ...
}
```

### Session

Session là runtime nội bộ của một thread đang sống trong process. Nó giữ:

- Conversation history.
- Config và settings hiện hành.
- Model client.
- MCP, tools và extensions.
- Active turn.
- Event channels.
- Rollout writer.

Struct chính nằm tại `codex-rs/core/src/session/session.rs:41`.

Phân biệt:

```text
Thread  = identity + public handle + durable conversation
Session = runtime đang thực thi thread đó
```

### Turn

Turn là một vòng công việc cấp người dùng. Một turn có thể chứa nhiều lần gọi model và nhiều tool call.

```text
User: sửa bug
Agent: đọc file
Agent: sửa code
Agent: chạy test
Agent: trả lời hoàn tất
```

Toàn bộ chuỗi trên thường vẫn là một turn.

### Step / sampling request

Mỗi request gửi tới model là một step:

```text
Step 1: model yêu cầu đọc file
Step 2: model nhận nội dung file và yêu cầu sửa
Step 3: model nhận kết quả sửa và yêu cầu test
Step 4: model nhận kết quả test và trả final answer
```

`TurnContext` sống suốt turn. `StepContext` là snapshot cho từng model request.

### ResponseItem

Đơn vị model nhìn thấy, ví dụ:

- User message.
- Assistant message.
- Function call.
- Function call output.
- Reasoning item.
- Typed context fragment.

### EventMsg

Đơn vị frontend nhìn thấy, ví dụ:

- Turn started/completed.
- Item started/completed.
- Text delta.
- Approval request.
- Tool output.
- Warning/error.
- Token usage.

`ResponseItem` là lịch sử dành cho model; `EventMsg` là protocol dành cho client/UI.

### Rollout

Rollout là transcript bền vững, chủ yếu ở dạng append-only JSONL. Nó được dùng cho resume, fork, audit, search, compression và recovery.

## 3. Entrypoint và các frontend

Entrypoint executable nằm tại `codex-rs/cli/src/main.rs:1038`. `MultitoolCli` parse argument và dispatch sang các mode:

- Interactive TUI.
- `codex exec`.
- `codex review`.
- App-server.
- MCP server.
- Exec-server.
- Login/logout.
- Sandbox helpers.
- Plugin, queue và cloud task.

Các điểm vào chính:

- Non-interactive exec: `codex-rs/cli/src/main.rs:1144`.
- App-server: `codex-rs/cli/src/main.rs:1287`.
- Interactive TUI: `codex-rs/cli/src/main.rs:2610`.
- Exec implementation: `codex-rs/exec/src/lib.rs:246`.
- TUI implementation: `codex-rs/tui/src/lib.rs:936`.

CLI không phải agent engine. Nó chủ yếu:

1. Parse argument.
2. Load config và auth.
3. Chọn frontend/backend.
4. Start hoặc kết nối thread.
5. Submit operations.
6. Consume events.

Vì vậy, nếu muốn học agent logic, không nên bắt đầu từ TUI.

## 4. Core API và production harness

Public API trung tâm gồm `ThreadManager` và `CodexThread`.

### ThreadManager

`ThreadManager` tại `codex-rs/core/src/thread_manager.rs:223` chịu trách nhiệm:

- Start thread mới.
- Resume/fork thread.
- Quản lý các thread đang sống.
- Kết nối thread store.
- Chuẩn bị auth, model manager, config, environments và extensions.

Điểm start thread chính nằm tại `codex-rs/core/src/thread_manager.rs:932`.

### CodexThread

`CodexThread` là facade frontend sử dụng:

```rust
thread.submit(op).await?;
let event = thread.next_event().await?;
```

Các API quan trọng:

- Submit operation: `codex-rs/core/src/codex_thread.rs:255`.
- Nhận event: `codex-rs/core/src/codex_thread.rs:585`.
- Shutdown và chờ: `codex-rs/core/src/codex_thread.rs:269`.
- Flush rollout: `codex-rs/core/src/codex_thread.rs:325`.

Đây là **production harness**: frontend không cần biết chi tiết model loop, tool router hay sandbox; nó chỉ submit command và consume event.

## 5. Protocol nội bộ: Op và EventMsg

Core protocol nằm trong crate `codex-protocol`:

- `Submission`: `codex-rs/protocol/src/protocol.rs:190`.
- `Op`: `codex-rs/protocol/src/protocol.rs:573`.
- `Event`: `codex-rs/protocol/src/protocol.rs:1317`.
- `EventMsg`: `codex-rs/protocol/src/protocol.rs:1335`.

Conceptually:

```rust
struct Submission {
    id: String,
    op: Op,
}

struct Event {
    id: String,
    msg: EventMsg,
}
```

`id` dùng để correlate submission, turn và event.

Các nhóm `Op`:

- Start hoặc steer turn.
- Interrupt.
- Approval response.
- User-input response.
- Update thread/turn settings.
- Shell process interaction.
- Realtime conversation.
- Suspend hoặc shutdown.

Các nhóm `EventMsg`:

- Session lifecycle.
- Turn lifecycle.
- Item lifecycle.
- Streaming deltas.
- Tool lifecycle.
- Approval và user-input request.
- Error/warning.
- Token, rate-limit và model metadata.

Rule thiết kế quan trọng: core không gọi trực tiếp UI. Core chỉ phát semantic event; TUI, exec và app-server tự render hoặc chuyển đổi event.

## 6. Session runtime và state machine

`SessionIo` giữ hai phía giao tiếp:

- Gửi `Submission` vào session.
- Nhận `Event` từ session.

Xem:

- `codex-rs/core/src/session/mod.rs:381`.
- `codex-rs/core/src/session/mod.rs:824`.
- `codex-rs/core/src/session/mod.rs:923`.

Khi session được tạo, core spawn `submission_loop`:

- Spawn loop: `codex-rs/core/src/session/mod.rs:807`.
- Loop implementation: `codex-rs/core/src/session/handlers.rs:520`.

Pseudo-code:

```rust
while let Some(submission) = rx.recv().await {
    match submission.op {
        Op::TurnInput { .. } => start_or_steer(...),
        Op::Interrupt => interrupt_active_turn(...),
        Op::ExecApprovalResponse { .. } => resolve_approval(...),
        Op::ThreadSettings { .. } => update_settings(...),
        Op::Shutdown => break,
        // ...
    }
}
```

Mental model phù hợp là actor-like runtime:

- Có inbox nhận `Op`.
- Session giữ state.
- Session phát `EventMsg`.
- Công việc nặng được spawn thành cancellable task.

### Active turn

Thông thường một session chỉ có một active turn task. Runtime lưu:

- Task handle.
- `CancellationToken`.
- `TurnContext`.
- Task kind.
- Completion notifier.
- Telemetry guards.

Khi task kết thúc:

1. Flush rollout.
2. Emit lifecycle completion.
3. Release active turn.
4. Kiểm tra pending input.
5. Có thể start turn tiếp theo.

## 7. Start turn và steering

Input handling nằm tại `codex-rs/core/src/session/turn_input.rs:232`.

### Khi session idle

Input mới tạo turn:

1. Resolve turn settings.
2. Capture `TurnContext`.
3. Tạo cancellation token.
4. Emit turn lifecycle.
5. Spawn `RegularTask`.

### Khi session đang chạy

Input mới có thể trở thành steering input:

- Không nhất thiết interrupt model ngay.
- Input được đưa vào `input_queue`.
- Sau tool call hoặc model response hiện tại, loop drain pending input.
- Input được append vào context trước sampling request tiếp theo.

Ví dụ user có thể nói trong lúc agent chạy:

```text
Đừng sửa file đó nữa, chuyển sang cách B.
```

`RegularTask` nằm tại `codex-rs/core/src/tasks/regular.rs:30`. Nó có thể gọi `run_turn()` nhiều lần nếu mailbox vẫn còn pending input.

```rust
loop {
    let result = run_turn(...).await?;

    if terminal_error {
        return;
    }

    if !has_pending_input {
        return;
    }

    next_input = Vec::new();
}
```

## 8. Một turn chạy như thế nào

Engine chính nằm tại `codex-rs/core/src/session/turn.rs:155`.

Contract cơ bản:

- Model trả assistant message thì có thể kết thúc turn.
- Model trả function/tool call thì core thực thi tool.
- Tool output được gửi lại model trong sampling request tiếp theo.
- Loop tiếp tục tới khi model không cần follow-up.

### Pipeline đầy đủ

#### 8.1 Drain async hook output

Kết quả hook chạy nền từ turn trước được đưa vào context trước user message mới.

#### 8.2 Lấy model client session

Core dùng prewarmed client nếu có; nếu không thì tạo mới bằng `sess.services.model_client.new_session()`. Prewarm giúp giảm latency request đầu tiên.

#### 8.3 Pre-sampling compaction

Trước khi thêm input mới, engine kiểm tra context window. Nếu gần vượt threshold, nó compact trước.

Compaction không đơn giản là xóa transcript. Nó tạo model-context window hoặc summary mới để projection gửi model nhỏ hơn, trong khi rollout đầy đủ vẫn tồn tại.

#### 8.4 Resolve MCP/plugin dependencies

User input có thể mention plugin hoặc cần MCP server cụ thể. Core xác định server cần thiết rồi đảm bảo chúng sẵn sàng.

#### 8.5 Capture StepContext

Step context snapshot lại:

- Model và settings.
- Environment.
- Permissions.
- Tool registry.
- MCP tool state.
- Collaboration mode.
- Feature flags.

Context, advertised tools và dispatched tools của một request phải dùng cùng snapshot.

#### 8.6 Update world state

Core so sánh world state hiện tại với snapshot trước đó và chỉ inject phần thay đổi.

#### 8.7 Build skill/plugin injection

Skills, plugin instructions và connector selection được biến thành typed model-visible items.

#### 8.8 Run turn hooks

Hook có thể:

- Bổ sung context.
- Chặn operation.
- Chạy đồng bộ.
- Chạy nền và inject kết quả sau.

#### 8.9 Record user input

User input được append vào conversation history và rollout.

#### 8.10 Build sampling input

Đoạn quan trọng tại `codex-rs/core/src/session/turn.rs:371`:

```rust
sess.clone_history()
    .await
    .for_prompt(&model_info.input_modalities)
```

Không phải toàn bộ rollout được gửi model. Core tạo projection gồm:

- Retained messages.
- Context fragments.
- Tool call/output pairs.
- Compaction summary.
- Chỉ modality model hỗ trợ.

#### 8.11 Send sampling request

Sampling request được gọi tại `codex-rs/core/src/session/turn.rs:383`. Prompt structure được định nghĩa quanh:

- `codex-rs/core/src/client_common.rs:19`.
- `codex-rs/core/src/session/turn.rs:1331`.
- `codex-rs/core/src/session/turn.rs:1360`.

#### 8.12 Consume streaming response

Engine xử lý:

- Assistant text deltas.
- Reasoning.
- Function calls.
- Tool argument deltas.
- Token usage.
- Model mismatch.
- Moderation metadata.
- Rate limits.
- Completion.

Các delta vừa được emit cho client, vừa được gom thành complete item để ghi history/rollout.

#### 8.13 Dispatch tool calls

Nếu model trả tool call:

1. Chuyển `ResponseItem` thành `ToolCall`.
2. Lookup runtime.
3. Emit tool-start event.
4. Chạy hook, approval và sandbox.
5. Execute tool.
6. Chuyển kết quả thành function call output.
7. Record output vào history.
8. Quay lại sampling loop.

#### 8.14 Finish

Khi model không cần follow-up:

- Drain in-flight tools.
- Record token usage.
- Emit turn diff.
- Emit final item/message completion.
- Flush rollout.
- Emit turn complete.

### Sequence diagram một tool call

```text
User        Frontend       Session       Model        Tool
 │              │             │             │           │
 │ prompt       │             │             │           │
 ├─────────────►│ submit Op    │             │           │
 │              ├────────────►│ request     │           │
 │              │             ├────────────►│           │
 │              │             │ tool call   │           │
 │              │             │◄────────────┤           │
 │              │             ├────────────────────────►│
 │              │ events      │ tool output │           │
 │              │◄────────────┤◄────────────────────────┤
 │              │             ├────────────►│           │
 │              │             │ final text  │           │
 │              │◄────────────┤◄────────────┤           │
 │ final answer │             │             │           │
 │◄─────────────┤             │             │           │
```

## 9. TurnContext và StepContext

`TurnContext` tại `codex-rs/core/src/session/turn_context.rs:182` chứa trạng thái ổn định cho toàn turn:

- Turn ID.
- Config.
- Model selection.
- Environments.
- Permissions.
- Collaboration mode.
- Telemetry.
- Extension data.
- Cancellation và error state.

`StepContext` là snapshot của một sampling request cụ thể.

Ví dụ:

```text
Turn bắt đầu với tool A, B
MCP refresh thêm tool C
Step 1 vẫn chỉ biết A, B
Step 2 mới có thể biết A, B, C
```

Nếu không snapshot:

- Model có thể gọi tool vừa biến mất.
- Tool advertised và tool dispatch có thể lệch nhau.
- Config có thể đổi giữa prompt construction và execution.
- Approval có thể dùng permission khác request đã thấy.

Đây là một trong những thiết kế quan trọng nhất của codebase.

## 10. Context và world state

Context không phải một chuỗi prompt khổng lồ được nối thủ công. Nó được mô hình hóa thành typed fragments trong:

- `codex-rs/core/src/context/`.
- `codex-rs/context-fragments/src/`.

Ví dụ fragment:

- Base instructions.
- Developer instructions.
- User instructions và `AGENTS.md`.
- Environment context.
- Permission instructions.
- Skills/plugins.
- Collaboration mode.
- Current-time reminder.
- Compaction summary.
- Inter-agent messages.
- Guardian policy/evidence.

Mỗi fragment có stable content kind, role, markers, body và cách chuyển thành model-visible item.

Thiết kế này giúp:

1. Deduplicate context.
2. Resume/fork đúng semantic state.
3. Chỉ inject diff thay vì lặp toàn bộ prompt.

### WorldStateSection

Interface cốt lõi tại `codex-rs/core/src/context/world_state/mod.rs:217`:

```rust
trait WorldStateSection {
    const ID: &'static str;
    type Snapshot;

    fn snapshot(&self) -> Self::Snapshot;

    fn render_diff(
        &self,
        previous: PreviousSectionState<'_, Self::Snapshot>,
    ) -> Option<Box<dyn ContextualUserFragment>>;
}
```

Các section gồm:

- `agents_md`.
- Environment.
- Permissions.
- Tools.
- Model.
- Personality.
- Collaboration mode.
- Multi-agent mode.
- Plugins.
- Realtime state.

`WorldState` registry nằm tại `codex-rs/core/src/context/world_state/mod.rs:283`.

### No history rewrite

Rule thiết kế:

- History tăng incremental.
- Không tùy tiện sửa ngược message cũ.
- Context mới được append.
- World-state change tạo diff/reconciliation fragment.
- Compaction tạo window/summary mới thay vì mutate quá khứ.

Lợi ích:

- Prompt cache ổn định hơn.
- Resume deterministic.
- Dễ audit.
- Tool call/output pairing không bị phá.

## 11. Tool architecture

Tool system chia thành bốn lớp.

### 11.1 Tool spec

Schema model nhìn thấy:

```json
{
  "name": "exec_command",
  "description": "...",
  "parameters": {}
}
```

Specs được build theo step tại `codex-rs/core/src/session/turn.rs:1514`.

### 11.2 Tool registry

Registry map `ToolName` sang runtime thực và quản lý:

- Exposure.
- Collision.
- Parallel support.
- Argument diff consumer.
- Deferred namespace.

### 11.3 Tool router

`ToolRouter` nằm tại `codex-rs/core/src/tools/router.rs:68`:

```rust
pub struct ToolRouter {
    registry: ToolRegistry,
    model_visible_specs: Arc<[ToolSpec]>,
}
```

Tool đã đăng ký không nhất thiết model-visible. Tool có thể:

- Visible ngay.
- Deferred.
- Chỉ discover qua tool search.
- Chỉ dùng cho internal/control flow.
- Bị feature, policy hoặc environment ẩn.

Router chuyển model item thành `ToolCall` tại `codex-rs/core/src/tools/router.rs:148`. Parallel capability được kiểm tra tại `codex-rs/core/src/tools/router.rs:137`.

### 11.4 Tool runtime

Runtime parse payload, chạy hook, approval, sandbox và trả `ToolOutput`.

Các handler đáng đọc:

- Unified exec: `codex-rs/core/src/tools/handlers/unified_exec.rs:1`.
- Apply patch: `codex-rs/core/src/tools/handlers/apply_patch.rs:1`.
- MCP: `codex-rs/core/src/tools/handlers/mcp.rs:1`.
- Plan: `codex-rs/core/src/tools/handlers/plan.rs:1`.
- User input: `codex-rs/core/src/tools/handlers/request_user_input.rs:1`.
- Permissions: `codex-rs/core/src/tools/handlers/request_permissions.rs:1`.
- Multi-agent: `codex-rs/core/src/tools/handlers/multi_agents.rs:1`.

### Tool call workflow

```text
Model FunctionCall(name, args, call_id)
                  │
                  ▼
      ToolRouter::build_tool_call
                  │
                  ▼
          Lookup ToolRegistry
          │               │
          │ missing       │ found
          ▼               ▼
 error gửi model     pre-tool hooks
                          │
                 parse typed request
                          │
                    approval gate
                          │
                  sandbox selection
                          │
                   runtime execute
                          │
                    post-tool hooks
                          │
            FunctionCallOutput(call_id)
                          │
               append model history
```

`call_id` nối `FunctionCall` với `FunctionCallOutput`. Nếu pairing hỏng thì model context và resume đều có thể hỏng.

## 12. Approval, exec policy và sandbox

Ba concept phải tách riêng.

### Approval policy

Quyết định **có cần hỏi người dùng hay không**. Các mode gồm:

- `Never`.
- `OnRequest`.
- `UnlessTrusted`.
- `Granular(...)`.

### Execution policy

Phân tích command/rule để quyết định:

- Được chạy.
- Cần hỏi.
- Bị cấm.
- Có thể đề xuất policy amendment.

Crate chính: `codex-rs/execpolicy/src/lib.rs:1`.

### Sandbox

Cơ chế OS thực sự giới hạn:

- Filesystem read/write.
- Process behavior.
- Network.
- Workspace roots.
- Denied-read paths.

Tóm lại:

```text
Approval   = authorization của user
ExecPolicy = rule engine đánh giá command
Sandbox    = enforcement ở runtime/OS
```

User đồng ý chưa chắc command chạy hoàn toàn unsandboxed. Ngược lại, command không cần hỏi vẫn có thể bị sandbox rất chặt.

### Runtime abstractions

Các abstraction nằm tại `codex-rs/core/src/tools/sandboxing.rs:308`.

`Approvable` quyết định:

- Permission request.
- Approval requirement.
- Có bypass approval không.
- Có xin no-sandbox execution không.
- Nội dung approval hiển thị cho user.

`Sandboxable` khai báo:

- Sandbox preference.
- Có retry/escalate khi sandbox failure không.

`ToolRuntime` tại `codex-rs/core/src/tools/sandboxing.rs:363`:

```rust
trait ToolRuntime<Req, Out>: Approvable<Req> + Sandboxable {
    async fn run(
        &mut self,
        req: &Req,
        attempt: &SandboxAttempt<'_>,
        ctx: &ToolCtx,
    ) -> Result<Out, ToolError>;
}
```

`SandboxAttempt` tại `codex-rs/core/src/tools/sandboxing.rs:386` chứa:

- Sandbox type.
- Effective permission profile.
- Canonical exec-server permissions.
- CWD.
- Workspace roots.
- Managed network proxy.
- Windows sandbox settings.
- Cancellation token.

### Typical execution

```text
1. Check cached approval
2. Evaluate exec policy
3. Determine approval requirement
4. Ask client nếu cần
5. Select first sandbox attempt
6. Materialize effective permissions
7. Execute
8. Detect likely sandbox denial
9. Nếu policy cho phép: ask/escalate/retry
10. Return normalized output
```

Safety invariant quan trọng: nếu permission profile có denied-read restrictions, escalation không được bỏ sandbox theo cách làm mất enforcement của denied reads. Logic nằm tại `codex-rs/core/src/tools/sandboxing.rs:275`.

### Sandbox theo OS

Các crate/file chính:

- Manager: `codex-rs/sandboxing/src/manager.rs:279`.
- macOS Seatbelt: `codex-rs/sandboxing/src/seatbelt.rs:1`.
- Linux bubblewrap: `codex-rs/sandboxing/src/bwrap.rs:1`.
- Linux Landlock: `codex-rs/sandboxing/src/landlock.rs:1`.
- Windows: `codex-rs/sandboxing/src/windows.rs:1`.

Backend tổng quát:

- macOS: Seatbelt.
- Linux: bubblewrap, Landlock hoặc seccomp tùy mode.
- Windows: restricted token, ACL, private desktop và WFP/network handling.
- Remote environment: exec-server có thể materialize sandbox.

Sandbox denial detection còn kiểm tra signal, known exit code và nội dung stderr/stdout. Xem `codex-rs/sandboxing/src/denial.rs:13`.

## 13. Persistence, rollout, resume và fork

Persistence chia thành hai crate lớn.

### codex-rollout

Phụ trách:

- JSONL recorder.
- Compression.
- Search/list.
- Session index.
- Ordinal.
- Rollout metadata.
- State DB bridge.
- Reverse scan và recovery.

Entrypoint: `codex-rs/rollout/src/lib.rs:1`.

Một rollout line có:

- Timestamp.
- Optional ordinal.
- Typed `RolloutItem`.

Decoder nằm tại `codex-rs/rollout/src/lib.rs:45`. Session directories được định nghĩa tại `codex-rs/rollout/src/lib.rs:67`.

### codex-thread-store

Storage abstraction cấp thread:

- Create/read/list.
- Archive/delete.
- Fork.
- Revert.
- Live writer.
- Local implementation.
- Migration.

Entrypoint: `codex-rs/thread-store/src/lib.rs:1`.

### Ba trạng thái cần phân biệt

```text
In-memory history = projection session đang dùng
Rollout           = durable ordered transcript
State DB/index    = metadata, discovery, listing, repair
```

### Resume workflow

1. Locate rollout/thread.
2. Decode rollout lines.
3. Reconstruct canonical history.
4. Tìm model-context/compaction window phù hợp.
5. Restore world-state snapshots.
6. Restore metadata và settings.
7. Tạo session runtime mới.
8. Append tiếp thay vì rewrite lịch sử.

Reconstruction nằm tại `codex-rs/core/src/session/rollout_reconstruction.rs:113`.

### Fork workflow

Source hỗ trợ các chiến lược như:

- Copy history.
- Reference ancestor history tới một ordinal boundary.

Logic khởi tạo fork/resume xuất hiện trong `codex-rs/core/src/session/session.rs:621`.

### Durability boundary

Trước khi turn hoàn tất, task cố flush rollout. Nếu flush lỗi:

- Turn có thể tiếp tục.
- Client nhận warning.
- Writer có thể tiếp tục retry theo policy.

Đây là lựa chọn ưu tiên availability nhưng vẫn báo rõ durability problem.

## 14. App-server và public API

Phân biệt ba protocol:

```text
codex-protocol            = frontend nội bộ ↔ core
app-server-protocol       = external client ↔ app-server
Responses API             = core ↔ model backend
```

### App-server flow

```text
JSON-RPC transport
       │
       ▼
Deserialize ClientRequest
       │
       ▼
Initialize/capability/experimental gate
       │
       ▼
MessageProcessor
       │
       ▼
Request-specific processor
       │
       ▼
ThreadManager / CodexThread
       │
       ▼
Core EventMsg
       │
       ▼
App-server v2 notification/request
```

Request deserialization nằm tại `codex-rs/app-server/src/message_processor.rs:104`. Dispatch chính nằm tại `codex-rs/app-server/src/message_processor.rs:596`.

### API v2

Public types nằm trong:

- `codex-rs/app-server-protocol/src/protocol/v2/mod.rs:1`.
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs:1`.
- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs:1`.
- `codex-rs/app-server-protocol/src/protocol/v2/item.rs:1`.

Resource model chính:

```text
initialize
thread/start
thread/resume
thread/read
turn/start
turn/interrupt
item/... notifications
```

Một số interaction là server-initiated request:

- Approval.
- User input.
- Dynamic tool.
- Attestation.
- MCP elicitation.

App-server giữ pending request map, chờ client response rồi chuyển thành internal `Op`.

### Vì sao cần app-server?

- IDE/desktop không phải link trực tiếp toàn bộ core.
- Hỗ trợ process boundary.
- Hỗ trợ capability negotiation và multi-client.
- Có generated TypeScript/schema.
- Public API có versioning riêng.
- Có thể chạy daemon và remote control.

## 15. MCP, plugin, skill và extension

### MCP

MCP có thể đóng góp:

- Tools.
- Resources.
- Prompts/elicitation.
- Auth refresh.
- Server lifecycle.

Session có prewarm và refresh riêng:

- `codex-rs/core/src/session/mcp_prewarm.rs:8`.
- `codex-rs/core/src/session/mcp_refresh.rs:1`.
- `codex-rs/core/src/session/mcp_runtime.rs:33`.

MCP tool được merge vào tool registry theo step snapshot, không mutate tùy tiện tool view đang dùng bởi request trước.

### Skills

Skill chủ yếu là instruction/resource injection. User mention skill hoặc resolver chọn skill phù hợp, sau đó nội dung được đưa vào context với giới hạn kích thước.

### Plugins

Plugin có thể đóng góp:

- Instructions.
- MCP requirements.
- Connectors.
- Tools/extensions.

### Extensions

Các crate dưới `codex-rs/ext/` đóng góp behavior mà không nhét mọi thứ vào `codex-core`, ví dụ:

- Agent.
- Goal.
- Guardian.
- Memory.
- MCP.
- Queue.
- Skills.
- Web search.
- Image generation.

Extension system có lifecycle contributor và typed extension data gắn vào session, thread hoặc turn. Đây là hướng giảm độ phình của `codex-core`.

## 16. Test harness

Đây là phần nên học sớm vì nó cho phép hiểu behavior mà không gọi model thật.

### Core integration harness

Builder nằm tại `codex-rs/core/tests/common/test_codex.rs:1`. Nó dựng:

- Temporary Codex home.
- Temporary workspace.
- Test config.
- Fake auth/model provider.
- `ThreadManager`.
- `CodexThread`.
- Mock Responses API server.
- Optional remote exec environment.
- Helpers submit turn và wait event.

### Fake model bằng SSE

Helpers nằm tại `codex-rs/core/tests/common/responses.rs:1`.

Một test agent thường làm:

```text
1. Mount SSE response #1:
   response.created
   function_call("exec_command", ...)
   response.completed

2. Start TestCodex
3. Submit user turn
4. Core gọi fake model
5. Core thực thi tool

6. Mount SSE response #2:
   response.created
   assistant_message("done")
   response.completed

7. Wait TurnComplete
8. Assert request #2 chứa function_call_output
```

Mock giữ lại outbound HTTP request, nên test có thể assert:

- Instructions.
- Input history.
- Tool schemas.
- Function call output.
- Headers.
- Metadata.
- Prompt cache behavior.

Các suite nên đọc:

- Agent/tool loop: `codex-rs/core/tests/suite/exec.rs:1`.
- Approval: `codex-rs/core/tests/suite/approvals.rs:1`.
- Context layout: `codex-rs/core/tests/suite/model_visible_layout.rs:1`.
- Compaction: `codex-rs/core/tests/suite/compact.rs:1`.
- MCP exposure: `codex-rs/core/tests/suite/mcp_tool_exposure.rs:1`.
- Pending input: `codex-rs/core/tests/suite/pending_input.rs:1`.

### App-server harness

App-server tests dùng public JSON-RPC thay vì gọi private core API:

```text
initialize
thread/start
turn/start
receive notifications
reply approval nếu có
assert turn completion
```

Ví dụ:

- `codex-rs/app-server/tests/suite/v2/turn_start.rs:1`.
- `codex-rs/app-server/tests/suite/v2/dynamic_tools.rs:1`.
- `codex-rs/app-server/tests/suite/v2/auto_env.rs:1`.

### TUI harness

TUI dùng `insta` snapshots để verify output user-visible. Thay đổi text/style/UI phải cập nhật snapshot tương ứng.

### Sandbox tests

Sandbox có unit test và platform integration test thật. Một số test tự skip khi môi trường hiện tại không hỗ trợ nested sandbox.

## 17. Các invariant quan trọng

Khi đọc hoặc sửa source, không nên phá các invariant sau:

1. Mỗi active turn có cancellation token và lifecycle rõ ràng.
2. Tool advertised cho model phải tương ứng runtime snapshot cùng step.
3. Function call và output phải nối bằng đúng `call_id`.
4. Model history tăng incremental, không rewrite tùy tiện.
5. Context injected phải bounded, không đưa dữ liệu vô hạn vào prompt.
6. World-state section ID phải stable vì được persist trong rollout.
7. Approval và sandbox phải độc lập.
8. Denied-read restrictions không được mất khi escalation.
9. Turn completion phải drain in-flight work cần thiết.
10. Resume phải tái dựng model-visible state tương đương trước khi process chết.
11. Public app-server behavior mới phải đi qua v2.
12. Core events không được phụ thuộc cách một UI cụ thể render.

## 18. Contributor workflow và rule

Các rule kiến trúc quan trọng từ `AGENTS.md`:

- Hạn chế thêm code vào `codex-core`; ưu tiên crate/module riêng.
- Module Rust nên dưới khoảng 500 dòng.
- File trên khoảng 800 dòng không nên tiếp tục phình nếu có thể tách.
- Trait mới phải có docs mô tả contract.
- Tránh `async_trait`; ưu tiên native RPITIT với explicit `Send`.
- App-server API mới chỉ thêm vào v2.
- App-server wire fields dùng camelCase, trừ config API.
- API shape thay đổi phải regenerate schema.
- UI thay đổi phải có snapshot coverage.
- Agent logic thay đổi phải có integration test.
- Không chạy `cargo test` trực tiếp; dùng `just test`.
- Thay dependency phải cập nhật Bazel lock.
- Build-time file read phải khai báo trong `BUILD.bazel`.
- Sau code change phải chạy `just fmt`.
- Large Rust change chạy `just fix -p <crate>` trước khi finalize.

### Workflow thay đổi code khuyến nghị

```text
1. Đọc AGENTS.md có scope áp dụng
2. Xác định public/internal boundary bị ảnh hưởng
3. Tìm integration test gần behavior đó
4. Viết thay đổi nhỏ, đúng crate sở hữu behavior
5. Thêm hoặc cập nhật test
6. Chạy targeted test: just test -p <crate>
7. Nếu UI thay đổi: review snapshot
8. Nếu config/API thay đổi: regenerate schema
9. Chạy just fix -p <crate> nếu change lớn
10. Chạy just fmt
11. Kiểm tra diff và lockfile/schema drift
```

## 19. Hướng phát triển coding-agent harness riêng

Phần này trả lời câu hỏi thực tế hơn: nếu dùng source Codex làm nền để xây một coding agent riêng, nên lấy phần nào, giữ boundary nào, thêm logic ở đâu và tránh fork sâu như thế nào.

### 19.1. Kết luận kiến trúc trước

Hướng khuyến nghị:

```text
Sản phẩm của mày sở hữu control plane
                 │
                 ▼
       App-server v2 contract
                 │
       in-process lúc phát triển
       remote process khi production
                 │
                 ▼
       Codex agent runtime nguyên bản
                 │
       extension / dynamic tool / MCP
                 │
                 ▼
    Tool và domain logic của sản phẩm
```

Không nên bắt đầu bằng việc copy `run_turn()` rồi viết agent loop mới. Nên giữ Codex làm **execution engine**, còn harness riêng sở hữu:

- Job và workflow cấp sản phẩm.
- User/tenant/project identity.
- Policy và approval UX.
- Workspace provisioning.
- Tool business-specific.
- Event projection và product state.
- Quota, billing, telemetry và audit.
- Retry, scheduling và recovery cấp job.

Codex tiếp tục sở hữu:

- Model sampling loop.
- Tool-call continuation.
- Context window và compaction.
- Session/turn lifecycle.
- Rollout và resume cấp conversation.
- Shell, patch và sandbox.
- MCP/tool routing.
- Model-facing context layout.

Boundary mặc định nên là **app-server v2**, kể cả khi hai phần chạy cùng process. Repo đã có in-process app-server để tránh socket overhead nhưng vẫn giữ đúng protocol semantics:

- Runtime in-process: `codex-rs/app-server/src/in_process.rs:1`.
- Client facade: `codex-rs/app-server-client/src/lib.rs:1`.
- Public v2 protocol: `codex-rs/app-server-protocol/src/protocol/v2/mod.rs:1`.

Lợi ích lớn nhất là sau này mày có thể chuyển từ:

```text
one process: product + embedded app-server
```

sang:

```text
product service ── transport ── app-server worker
```

mà không phải đổi workflow và event model của sản phẩm.

### 19.2. Ba cách tích hợp

#### Cách A: app-server v2 qua process boundary

```text
Your API/UI
    │ JSON-RPC
    ▼
codex app-server process
    │
    ▼
Codex core
```

Phù hợp khi:

- Agent chạy như worker riêng.
- Cần crash isolation.
- Host viết bằng TypeScript, Go, Python hoặc ngôn ngữ khác Rust.
- Cần nâng cấp agent runtime độc lập với product API.
- Muốn scale worker theo workspace/job.

Đánh đổi:

- Phải quản lý process và transport.
- Phải correlate server requests, notifications và responses.
- File path/environment cần được mô hình hóa rõ giữa host và worker.

#### Cách B: in-process app-server

```text
Rust product
    │ typed ClientRequest
    ▼
InProcessAppServerClient
    │ bounded channels
    ▼
MessageProcessor → Codex core
```

Đây là lựa chọn tốt nhất để làm MVP bằng Rust. Nó giữ app-server contract nhưng bỏ process/socket boundary.

Repo mô tả lifecycle như sau:

1. Dựng startup args.
2. Start runtime và handshake nội bộ.
3. Gửi typed request/notification.
4. Consume `InProcessServerEvent`.
5. Resolve server request khi cần approval/tool/user input.
6. Shutdown có giới hạn thời gian.

Điểm cần lưu ý:

- Command channels có capacity hữu hạn.
- Consumer có thể nhận marker `Lagged` ở API low-level.
- Facade client dùng event queue riêng để event unread không block request processing.
- Product vẫn phải drain event liên tục.

#### Cách C: embed trực tiếp `codex-core-api`

Sample chính thức nằm tại `codex-rs/thread-manager-sample/src/main.rs:1` và chỉ phụ thuộc `codex-core-api`.

Flow:

```text
build Config
init state DB
build AuthManager
build EnvironmentManager
build ExtensionRegistry
build ThreadManager
start_thread
start_turn_if_idle
next_event loop
shutdown_and_wait
```

Phù hợp khi:

- Host chắc chắn viết bằng Rust.
- Cần native extension sâu.
- Cần truy cập trực tiếp `CodexThread` hoặc internal events.
- Chấp nhận coupling cao hơn với source Codex.

Không nên dùng làm boundary công khai của sản phẩm. `codex-core-api` là facade tốt hơn phụ thuộc trực tiếp `codex-core`, nhưng vẫn gần engine hơn app-server protocol.

### 19.3. Ma trận lựa chọn

| Nhu cầu | Lựa chọn |
| --- | --- |
| MVP Rust chạy local | In-process app-server |
| Host không phải Rust | App-server process |
| Worker isolation/multi-tenant | App-server process |
| Custom native tool cần state nội bộ | `codex-core-api` + extension |
| Business tool do product service sở hữu | Dynamic tool hoặc MCP |
| Contract ổn định để nâng cấp upstream | App-server v2 |
| Prototype một turn cực nhỏ | `thread-manager-sample` |

Kiến trúc thực tế có thể hybrid:

```text
Product orchestrator
       │
       ├─ app-server v2: thread/turn/event contract
       │
       ├─ dynamic tools: callback sang product runtime
       │
       └─ extension crate: context/policy native thật sự cần thiết
```

### 19.4. Kiến trúc harness đề xuất

```text
┌──────────────── Product Surface ────────────────┐
│ CLI / Web / IDE / API                           │
└──────────────────────┬──────────────────────────┘
                       ▼
┌──────────────── Harness Control Plane ──────────┐
│ JobService                                      │
│ ThreadService                                   │
│ ApprovalBroker                                  │
│ WorkspaceManager                               │
│ PolicyEngine                                    │
│ ToolGateway                                     │
│ EventProjector                                  │
│ Scheduler / Recovery                            │
└──────────────────────┬──────────────────────────┘
                       ▼
┌──────────────── Codex Gateway ──────────────────┐
│ AppServerClient                                 │
│ Request correlation                            │
│ Event pump                                      │
│ Server-request dispatcher                      │
│ Protocol compatibility adapter                 │
└──────────────────────┬──────────────────────────┘
                       ▼
┌──────────────── Codex Runtime ──────────────────┐
│ app-server → ThreadManager → Session → Turn     │
│ model loop → tools → sandbox → rollout          │
└──────────────────────┬──────────────────────────┘
                       ▼
┌──────────────── Execution Plane ────────────────┐
│ Local workspace / container / VM / exec-server │
│ Git provider / CI / issue tracker / MCP         │
└─────────────────────────────────────────────────┘
```

#### `JobService`

Job là concept của sản phẩm, không phải turn của Codex.

Ví dụ một job “fix issue” có thể gồm:

```text
Provision workspace
Start/resume thread
Run coding turn
Wait approval
Run validation turn
Create patch artifact
Ask user review
Optionally open PR
Archive workspace
```

Một job có thể có nhiều thread hoặc nhiều turn. Không nên ép business workflow vào một prompt khổng lồ.

#### `ThreadService`

Giữ mapping:

```text
product_job_id → product_thread_id → codex_thread_id
```

Nó chịu trách nhiệm:

- Start/resume/fork/archive.
- Gắn project/workspace/tenant.
- Lưu model và policy profile đã chọn.
- Chống submit turn trùng.
- Theo dõi active turn.

#### `ApprovalBroker`

Biến server-initiated approval request thành product workflow:

```text
Codex approval request
       │
       ▼
Normalize action evidence
       │
       ├─ policy auto-allow
       ├─ policy auto-deny
       └─ create pending approval
                    │
                    ▼
              user/admin response
                    │
                    ▼
        resolve original request ID
```

Broker phải lưu:

- Request ID của app-server.
- Thread ID và turn ID.
- Canonical action payload.
- Policy reason/retry reason.
- Deadline.
- Decision actor.
- Final resolution.

Không chỉ lưu chuỗi prompt approval; phải lưu structured payload để audit và áp policy.

#### `WorkspaceManager`

Sở hữu lifecycle của workspace:

- Clone/open repository.
- Chọn branch hoặc worktree.
- Apply credentials theo scope.
- Tạo environment identity.
- Cleanup theo retention policy.
- Snapshot diff/artifact sau turn.

Rule an toàn:

- Một job không dùng chung writable workspace với job không liên quan.
- Git credentials không được inject vào prompt hoặc tool output.
- Workspace path phải canonicalize trước khi cấp permission.
- Cleanup là job riêng có retry, không nằm trong happy-path turn completion.

#### `ToolGateway`

Sở hữu business tools như:

- `issues.get`
- `ci.get_failure`
- `repo.open_pull_request`
- `tickets.update`
- `artifacts.publish`

Gateway làm:

- Authentication và tenant scoping.
- Input validation.
- Idempotency.
- Timeout/cancellation.
- Output truncation/redaction.
- Audit.
- Stable error schema cho model.

#### `EventProjector`

Không để UI phụ thuộc trực tiếp hàng trăm app-server notifications. Project event thành state sản phẩm:

```text
JobState
├── status
├── current_turn
├── latest_message
├── plan
├── running_tools
├── pending_approval
├── changed_files
├── validation_summary
└── terminal_error
```

Raw events vẫn nên lưu có giới hạn để debug, nhưng UI đọc projection ổn định hơn.

### 19.5. Domain model tối thiểu

```rust
struct AgentJob {
    id: JobId,
    tenant_id: TenantId,
    project_id: ProjectId,
    workspace_id: WorkspaceId,
    codex_thread_id: Option<String>,
    status: JobStatus,
    policy_profile: PolicyProfileId,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

enum JobStatus {
    Queued,
    Provisioning,
    Running,
    WaitingForApproval,
    WaitingForUserInput,
    Validating,
    Completed,
    Failed,
    Cancelled,
}
```

Nên tách thêm:

```text
AgentThreadLink
AgentTurn
PendingServerRequest
ToolExecutionAudit
WorkspaceLease
JobArtifact
EventCheckpoint
```

Không dùng rollout làm database sản phẩm. Rollout là transcript/runtime persistence của Codex; product DB vẫn cần giữ job state, authorization và idempotency.

### 19.6. Workflow runtime đề xuất

#### Start job

```text
POST /jobs
  │
  ├─ validate tenant/project/policy
  ├─ persist Job(Queued)
  └─ enqueue provision command
```

Worker:

```text
claim job lease
provision isolated workspace
start app-server worker/client
thread/start với cwd, model, permissions, tools
persist codex thread ID
turn/start với user objective
enter event pump
```

#### Event pump

Mỗi running worker cần một task duy nhất làm owner của inbound event stream:

```text
loop {
    event = client.next_event()
    persist/checkpoint event identity
    project event into JobState

    match event {
        notification => broadcast product update,
        server request => dispatch broker/tool/user-input handler,
        lagged => mark stream inconsistent and reconcile,
        closed => recover or fail job,
    }
}
```

Không nên có nhiều consumer cùng gọi `next_event()`: event ownership sẽ không deterministic.

#### Tool callback

```text
item/tool/call
   │
   ├─ validate namespace/tool
   ├─ verify thread↔tenant binding
   ├─ derive idempotency key from thread/turn/call
   ├─ execute with deadline
   ├─ redact and bound output
   └─ respond success/failure exactly once
```

#### Cancellation

Product cancel không chỉ đổi DB state:

1. Mark cancellation requested.
2. Gửi turn interrupt.
3. Chờ terminal event trong deadline.
4. Shutdown worker nếu không phản hồi.
5. Release workspace lease.
6. Giữ artifact/log cần audit.

#### Recovery

Khi worker chết:

```text
inspect product job state
inspect last event checkpoint
locate Codex thread/rollout
resume thread if safe
reconcile pending server requests
either continue or mark NeedsAttention
```

Không tự động replay một mutating dynamic tool chỉ vì không thấy response. Tool phải có idempotency record để biết action đã thực hiện chưa.

### 19.7. Chọn cơ chế custom tool

Có ba lựa chọn chính.

#### Dynamic tool

App-server cho phép khai báo `dynamicTools` ở `thread/start`; khi model gọi, server gửi `item/tool/call` về client. Protocol nằm tại `codex-rs/app-server-protocol/src/protocol/v2/thread.rs:138` và flow được mô tả trong `codex-rs/app-server/README.md:1943`.

Nên dùng khi:

- Tool thuộc product host.
- Tool gọi database/internal service.
- Muốn implementation ở ngoài Codex process.
- Cần per-thread tool set.

Hiện surface này được đánh dấu experimental, nên gateway của mày phải cô lập version drift.

#### Native extension tool

Extension API expose `ToolContributor`; registry method nằm tại `codex-rs/ext/extension-api/src/registry.rs:126`, trait tại `codex-rs/ext/extension-api/src/contributors.rs:300`.

Nên dùng khi:

- Tool cần state/session store nội bộ.
- Tool cần chạy sát engine với latency thấp.
- Tool cần tham gia exact step snapshot.
- Mày kiểm soát Rust build của runtime.

Không nên cho mọi integration business thành native extension vì sẽ tăng coupling và release cost.

#### MCP tool

Nên dùng khi:

- Tool đã có MCP server.
- Muốn tool discovery/config độc lập.
- Muốn tái sử dụng ngoài sản phẩm hiện tại.
- Tool boundary phù hợp network/process isolation.

Đánh đổi là lifecycle, auth, startup latency và schema refresh phức tạp hơn dynamic tool.

### 19.8. Custom context và policy

Không nối domain context thành một string khổng lồ trước prompt. Chọn đúng scope:

- Thread context: policy ổn định cho toàn thread.
- Turn context: objective/data thay đổi theo turn.
- World state: trạng thái có snapshot và diff qua nhiều step.
- Tool output: dữ liệu chỉ cần sau một action cụ thể.

Extension API có `ContextContributor` tại `codex-rs/ext/extension-api/src/contributors.rs:90`. Example nhỏ nằm tại `codex-rs/ext/extension-api/examples/enabled_extensions/shared_state_extension.rs:1`.

Quy tắc cho context riêng:

- Mỗi fragment có stable content kind.
- Có hard byte/token limit.
- Redact secret trước khi render.
- Không inject toàn bộ ticket history nếu model chỉ cần summary.
- Dữ liệu thay đổi thường xuyên nên dùng world-state diff.
- Dữ liệu fetch được nên có provenance và timestamp.
- Không dùng context để “cấp quyền”; quyền phải được enforce ngoài prompt.

Approval automation có thể đi qua `ApprovalReviewContributor` tại `codex-rs/ext/extension-api/src/contributors.rs:347`, nhưng product policy vẫn phải fail closed. Model-based reviewer không thay thế filesystem/network sandbox.

### 19.9. Security model

Threat model tối thiểu:

```text
Untrusted repository content
Untrusted AGENTS.md/instructions
Untrusted model output
Untrusted tool arguments
Untrusted tool output
Potentially malicious dependency scripts
Cross-tenant data leakage
Credential exfiltration
Prompt injection through issues/docs/web
```

Các lớp phòng thủ:

#### Identity

- Bind job, thread, workspace và tenant bằng immutable IDs.
- Mọi tool call kiểm tra binding server-side.
- Không tin tenant/project ID do model truyền trong arguments.

#### Filesystem

- Default read-only ngoài workspace.
- Write chỉ vào workspace roots cần thiết.
- Deny read cho credential/key locations.
- Canonicalize symlink/path traversal.
- Không cho approval escalation làm mất denied-read enforcement.

#### Network

- Default deny hoặc allowlist domain.
- Proxy ghi audit theo job.
- Token service chỉ cấp credential ngắn hạn theo destination/action.
- Không đặt broad cloud credentials trong process environment nếu tránh được.

#### Tools

- Strict JSON schema.
- Payload size limit.
- Deadline và cancellation.
- Idempotency cho mutation.
- Output cap và secret redaction.
- Phân loại read/write/destructive.

#### Approval

- Approval hiển thị action canonical, không chỉ lời giải thích từ model.
- Decision có actor, timestamp và scope.
- “Allow once” khác “allow for turn/project”.
- Destructive action không được tự động retry sau timeout.

#### Persistence

- Rollout có thể chứa source, command và output nhạy cảm.
- Encrypt storage nếu threat model yêu cầu.
- Có retention/delete policy.
- Product logs không duplicate toàn bộ transcript mặc định.

### 19.10. Reliability và concurrency

#### Một owner cho một live thread

Dùng lease:

```text
thread_id
owner_worker_id
lease_expires_at
fencing_token
```

Mọi mutation check fencing token để worker cũ không tiếp tục ghi sau khi lease bị takeover.

#### Idempotency

Các command product-side cần key:

```text
create_job: client request key
start_turn: job_id + turn_sequence
dynamic_tool: thread_id + turn_id + call_id
publish_artifact: job_id + artifact_kind + revision
open_pr: repository + branch + job_id
```

#### Backpressure

- Event pump phải luôn được drain.
- Streaming delta có thể coalesce cho UI.
- Lifecycle, approval và terminal events không được drop.
- Raw event retention phải bounded.
- Chậm consumer thì disconnect UI, không block agent worker.

#### Timeout

Tách deadline:

- Model request timeout.
- Tool execution timeout.
- Approval/user-input deadline.
- Whole-turn deadline.
- Whole-job deadline.
- Graceful shutdown deadline.

Không dùng một timeout chung vì recovery semantics khác nhau.

### 19.11. Model và provider strategy

Đừng để product logic phụ thuộc tên model cụ thể. Dùng profile:

```text
fast
balanced
deep
review
```

Profile resolve thành:

- Provider/model.
- Reasoning effort.
- Context/token budget.
- Tool exposure.
- Max turn/job cost.
- Fallback policy.

Persist resolved profile theo turn để audit. Nếu model fallback giữa turn, event/projector phải ghi nhận model thực tế.

### 19.12. Repo/module layout cho harness

Nếu phát triển ngay trong Rust workspace này, một layout sạch có thể là:

```text
codex-rs/my-agent-domain/
codex-rs/my-agent-policy/
codex-rs/my-agent-tools/
codex-rs/my-agent-runtime/
codex-rs/my-agent-api/
codex-rs/my-agent-cli/
codex-rs/my-agent-test-support/
```

Vai trò:

- `domain`: IDs, job state, commands, events; không phụ thuộc Codex core.
- `policy`: authorization và approval decisions.
- `tools`: business tool implementations và schemas.
- `runtime`: app-server gateway, event pump, recovery.
- `api`: HTTP/JSON hoặc RPC cho UI.
- `cli`: local developer surface.
- `test-support`: fake app-server/model/tool services.

Dependency direction:

```text
domain ← policy
domain ← tools
domain ← runtime → app-server-client/protocol
domain ← api → runtime
domain ← cli → runtime
```

Không cho `domain` import `codex-core`. Điều này giữ product model độc lập với upstream internals.

Nếu harness nằm repo riêng, pin một Codex revision/release và đặt compatibility adapter trong đúng một package, ví dụ `agent_runtime_codex`.

### 19.13. Public API của sản phẩm

Product API nên nói ngôn ngữ job, không mirror nguyên app-server:

```text
POST   /jobs
GET    /jobs/{id}
POST   /jobs/{id}/messages
POST   /jobs/{id}/cancel
GET    /jobs/{id}/events
POST   /approvals/{id}/decision
POST   /user-input/{id}/response
GET    /jobs/{id}/artifacts
```

App-server IDs vẫn được giữ nội bộ để correlation. Chỉ expose nếu client thực sự cần low-level debugging.

Event API sản phẩm nên có stable envelope:

```json
{
  "eventId": "evt_...",
  "jobId": "job_...",
  "sequence": 42,
  "type": "tool.completed",
  "occurredAt": 1787788800,
  "data": {}
}
```

`sequence` giúp reconnect client và phát hiện gap.

### 19.14. Test strategy

#### Contract tests cho Codex gateway

- Typed request serialize đúng app-server v2.
- Notification map đúng product event.
- Unknown event không crash worker.
- Experimental field được capability-gate.
- Upgrade revision phát hiện protocol drift.

#### Agent integration tests

Dùng fake Responses SSE giống core harness:

```text
response 1: model calls product tool
host resolves tool
response 2: model calls exec
approval resolves
response 3: assistant final
assert product JobState and outbound requests
```

#### Policy tests

- Table-driven tests cho command/action classes.
- Permission intersection.
- Cross-tenant denial.
- Denied-read giữ nguyên sau escalation.
- Approval scope expiry.

#### Recovery tests

- Kill worker giữa model stream.
- Kill sau mutating tool nhưng trước response.
- Drop event consumer.
- Expire thread lease.
- Resume rollout sau restart.
- Duplicate turn-start command.

#### Sandbox tests

Chạy platform matrix cho macOS/Linux/Windows hoặc remote exec-server. Unit tests không đủ để chứng minh enforcement thật.

### 19.15. Observability

Mỗi log/span nên correlate ít nhất:

```text
tenant.id
project.id
job.id
workspace.id
thread.id
turn.id
tool.call_id
model
worker.id
```

Metrics hữu ích:

- Queue latency.
- Workspace provision latency.
- Time to first model token.
- Turn duration.
- Tool duration/error rate.
- Approval wait time.
- Sandbox denial/escalation count.
- Tokens và estimated cost theo job.
- Resume/recovery count.
- Event lag/drop count.

Không log prompt/tool payload mặc định ở production. Tách metadata telemetry khỏi debug transcript.

### 19.16. Upgrade strategy

Codex upstream thay đổi nhanh, nên:

1. Pin commit/release, không track floating branch.
2. Giữ patch downstream nhỏ.
3. Không sửa `run_turn()` nếu extension/protocol giải quyết được.
4. Có compatibility adapter cho app-server types.
5. Chạy contract suite trước mỗi bump.
6. Review schema diff và generated TS diff.
7. Review rollout/resume compatibility nếu thay core.
8. Rebase thường xuyên thay vì để fork lệch hàng tháng.

Nếu buộc phải patch core, phân loại patch:

- Upstreamable generic feature.
- Product-specific extension point.
- Temporary compatibility patch.
- Security hardening.

Generic feature và extension point nên thiết kế để upstream; business rule nên ở harness riêng.

### 19.17. Những thứ không nên làm

- Copy toàn bộ `codex-core` rồi đổi tên.
- Viết lại model/tool loop trước khi có behavior test.
- Cho UI consume raw internal `EventMsg` lâu dài.
- Dùng prompt để enforce security.
- Cho model truyền tenant/project credential selector.
- Tự động retry mutation không idempotent.
- Dùng rollout làm product database.
- Inject toàn bộ repository/ticket history vào context.
- Cho nhiều task cùng consume một event receiver.
- Tạo một global writable workspace cho nhiều user.
- Fork app-server v1; mọi API mới phải đi v2.

### 19.18. MVP đề xuất

Scope MVP có chủ đích:

```text
Một user
Một local repository
Một worker
Một model profile
In-process app-server
Shell + patch built-in
Một dynamic read-only tool
Manual approval
Local thread store
SSE event API đơn giản
Không multi-agent
Không memory dài hạn
Không auto-open PR
```

Vertical slice đầu tiên:

1. Start runtime.
2. `thread/start` cho một repo.
3. `turn/start` với task nhỏ.
4. Stream message/tool events ra terminal hoặc web.
5. Handle approval request thủ công.
6. Wait turn complete.
7. Restart process và resume thread.
8. Test toàn flow bằng fake model.

MVP thành công khi deterministic integration test chạy được mà không gọi model thật.

### 19.19. Roadmap 12 tuần

#### Tuần 1-2: vertical slice

- Dựng in-process app-server client.
- Start thread/turn.
- Event pump duy nhất.
- Console projection.
- Graceful shutdown.

#### Tuần 3-4: persistence và resume

- Product job DB.
- Mapping job↔thread.
- Resume sau restart.
- Event sequencing/checkpoint.
- Workspace lease.

#### Tuần 5-6: policy và approval

- Approval broker.
- Permission profiles.
- Manual approval UI/API.
- Audit records.
- Cancellation deadlines.

#### Tuần 7-8: product tools

- Tool gateway.
- Một read tool và một idempotent write tool.
- Timeout/redaction/output caps.
- Dynamic-tool contract tests.

#### Tuần 9-10: reliability

- Worker crash recovery.
- Duplicate command protection.
- Backpressure/reconnect.
- Artifact collection.
- Platform sandbox tests.

#### Tuần 11-12: production hardening

- Tenant isolation.
- Secret broker.
- Quota/cost budgets.
- Metrics/tracing.
- Codex upgrade contract suite.
- Threat-model review.

### 19.20. Điểm bắt đầu trong source

Đọc và chạy theo thứ tự:

1. `codex-rs/thread-manager-sample/src/main.rs:1` để hiểu embedded core tối thiểu.
2. `codex-rs/core-api/src/lib.rs:1` để biết facade được hỗ trợ.
3. `codex-rs/app-server/src/in_process.rs:1` để hiểu runtime embedded nhưng giữ protocol.
4. `codex-rs/app-server-client/src/lib.rs:1` để dùng facade client.
5. `codex-rs/app-server-protocol/src/protocol/v2/thread.rs:1` cho thread contract.
6. `codex-rs/app-server-protocol/src/protocol/v2/turn.rs:1` cho turn contract.
7. `codex-rs/app-server-protocol/src/protocol/v2/item.rs:1` cho event/item projection.
8. `codex-rs/app-server/tests/suite/v2/turn_start.rs:1` cho end-to-end examples.
9. `codex-rs/ext/extension-api/src/registry.rs:26` khi cần native extension.
10. `codex-rs/core/tests/common/responses.rs:1` để dựng deterministic fake model.

Thiết kế cuối cùng nên giữ nguyên nguyên tắc:

```text
Codex là agent execution engine.
Harness của mày là product control plane.
App-server v2 là contract giữa hai phía.
Extension/dynamic tool/MCP là nơi thêm capability.
Policy và sandbox là enforcement, không phải prompt text.
```

## 20. Lộ trình đọc source

Không nên đọc toàn bộ repo tuyến tính. Hãy lần một request từ ngoài vào trong.

### Giai đoạn 1: Protocol và harness

Đọc theo thứ tự:

1. `codex-rs/protocol/src/protocol.rs:190`.
2. `codex-rs/core/src/codex_thread.rs:210`.
3. `codex-rs/core/src/thread_manager.rs:932`.
4. `codex-rs/core/src/session/mod.rs:824`.

Mục tiêu: hiểu ai gửi `Op`, ai nhận `Event`.

### Giai đoạn 2: State machine

1. `codex-rs/core/src/session/handlers.rs:520`.
2. `codex-rs/core/src/session/turn_input.rs:232`.
3. `codex-rs/core/src/tasks/regular.rs:30`.
4. `codex-rs/core/src/session/turn.rs:155`.

Mục tiêu: trace một user input thành turn task.

### Giai đoạn 3: Model loop

1. `codex-rs/core/src/session/turn.rs:303`.
2. `codex-rs/core/src/session/turn.rs:371`.
3. `codex-rs/core/src/session/turn.rs:1360`.
4. `codex-rs/core/src/client_common.rs:19`.

Mục tiêu: hiểu vì sao một turn có nhiều model request.

### Giai đoạn 4: Tool

1. `codex-rs/core/src/tools/router.rs:68`.
2. `codex-rs/core/src/tools/registry.rs:1`.
3. `codex-rs/core/src/tools/orchestrator.rs:1`.
4. `codex-rs/core/src/tools/handlers/unified_exec.rs:1`.

Mục tiêu: trace function call tới runtime.

### Giai đoạn 5: Approval và sandbox

1. `codex-rs/core/src/tools/sandboxing.rs:308`.
2. `codex-rs/core/src/tools/approvals.rs:1`.
3. `codex-rs/execpolicy/src/policy.rs:1`.
4. `codex-rs/sandboxing/src/manager.rs:279`.

Mục tiêu: phân biệt authorization, policy và enforcement.

### Giai đoạn 6: Context

1. `codex-rs/core/src/context/world_state/mod.rs:217`.
2. `codex-rs/core/src/context_manager/history.rs:1`.
3. `codex-rs/core/src/context/world_state/agents_md.rs:1`.
4. `codex-rs/core/src/compact.rs:1`.

Mục tiêu: hiểu model thực sự nhìn thấy gì.

### Giai đoạn 7: Persistence

1. `codex-rs/rollout/src/lib.rs:1`.
2. `codex-rs/rollout/src/recorder.rs:1`.
3. `codex-rs/core/src/session/rollout_reconstruction.rs:113`.
4. `codex-rs/thread-store/src/lib.rs:1`.

Mục tiêu: hiểu resume/fork giữ semantic state thế nào.

### Giai đoạn 8: Public API và UI

1. `codex-rs/app-server/src/message_processor.rs:596`.
2. `codex-rs/app-server-protocol/src/protocol/v2/thread.rs:1`.
3. `codex-rs/tui/src/app_server_session.rs:734`.
4. `codex-rs/exec/src/lib.rs:1067`.

Mục tiêu: hiểu core events được chuyển thành UX/public API thế nào.

### Kế hoạch học bốn tuần

#### Tuần 1: Core state machine

- Ngày 1: `Op`, `Event`, `CodexThread`.
- Ngày 2: `ThreadManager`, session startup.
- Ngày 3: `submission_loop`.
- Ngày 4: `turn_input` và `RegularTask`.
- Ngày 5-7: trace một turn đơn giản bằng integration test.

#### Tuần 2: Model loop và context

- Đọc `run_turn()` theo từng block.
- Inspect outbound request trong test harness.
- So sánh history, world state và rollout.
- Thử thay environment hoặc permission giữa hai turn.

#### Tuần 3: Tool và sandbox

- Trace `exec_command` từ spec tới runtime.
- Học approval response flow.
- Học exec policy.
- So sánh sandbox backend theo OS.

#### Tuần 4: Persistence và app-server

- Chạy resume/fork tests.
- Đọc rollout recorder/reconstruction.
- Trace `turn/start` JSON-RPC tới internal `Op`.
- Trace internal `EventMsg` trở lại app-server notification.

## 21. Bài tập thực hành

### Bài 1: Turn không có tool

- Fake model trả assistant message.
- Log toàn bộ `EventMsg`.
- Xác định event bắt đầu và kết thúc.
- Inspect outbound Responses request.

### Bài 2: Một tool call

- Fake model gọi `exec_command`.
- Fake response thứ hai trả final message.
- Assert request thứ hai chứa tool output đúng `call_id`.

### Bài 3: Steering

- Trong khi tool chạy, submit input thứ hai.
- Quan sát input vào mailbox.
- Xác định sampling request nào nhận steering message.

### Bài 4: Approval

- Tạo command cần approval.
- Quan sát approval event.
- Reply accept rồi chạy lại với reject.
- So sánh model-visible output hai trường hợp.

### Bài 5: Context diff

- Turn 1 dùng environment A.
- Turn 2 đổi permission hoặc cwd.
- So sánh hai prompt request.
- Xác nhận chỉ section thay đổi được inject.

### Bài 6: Resume

- Chạy turn có tool.
- Shutdown.
- Resume rollout.
- Chạy turn tiếp.
- Kiểm tra tool history và world state vẫn đúng.

### Bài 7: App-server

- Gửi `initialize`.
- Gửi `thread/start`.
- Gửi `turn/start`.
- Consume JSON-RPC notifications.
- So sánh chúng với internal `EventMsg`.

## 22. Bản đồ file tra cứu nhanh

| Chủ đề | File bắt đầu |
| --- | --- |
| CLI dispatch | `codex-rs/cli/src/main.rs:1038` |
| Public thread facade | `codex-rs/core/src/codex_thread.rs:210` |
| Thread creation | `codex-rs/core/src/thread_manager.rs:932` |
| Internal protocol | `codex-rs/protocol/src/protocol.rs:573` |
| Session channels | `codex-rs/core/src/session/mod.rs:381` |
| Submission state machine | `codex-rs/core/src/session/handlers.rs:520` |
| Turn input/steering | `codex-rs/core/src/session/turn_input.rs:232` |
| Regular turn task | `codex-rs/core/src/tasks/regular.rs:30` |
| Main model loop | `codex-rs/core/src/session/turn.rs:155` |
| Turn context | `codex-rs/core/src/session/turn_context.rs:182` |
| Tool router | `codex-rs/core/src/tools/router.rs:68` |
| Tool registry | `codex-rs/core/src/tools/registry.rs:1` |
| Tool sandboxing | `codex-rs/core/src/tools/sandboxing.rs:308` |
| Exec policy | `codex-rs/execpolicy/src/lib.rs:1` |
| Sandbox manager | `codex-rs/sandboxing/src/manager.rs:279` |
| World state | `codex-rs/core/src/context/world_state/mod.rs:217` |
| Compaction | `codex-rs/core/src/compact.rs:1` |
| Rollout | `codex-rs/rollout/src/lib.rs:1` |
| Resume reconstruction | `codex-rs/core/src/session/rollout_reconstruction.rs:113` |
| Thread store | `codex-rs/thread-store/src/lib.rs:1` |
| App-server dispatch | `codex-rs/app-server/src/message_processor.rs:596` |
| App-server v2 protocol | `codex-rs/app-server-protocol/src/protocol/v2/mod.rs:1` |
| Core test harness | `codex-rs/core/tests/common/test_codex.rs:1` |
| Fake model responses | `codex-rs/core/tests/common/responses.rs:1` |

## Tóm tắt cuối

Kiến trúc cốt lõi có thể nhớ bằng chuỗi sau:

```text
ThreadManager tạo CodexThread
CodexThread gửi Op vào Session
Session biến input thành cancellable Task
Task chạy model sampling loop
Model gọi tool qua ToolRouter
Tool đi qua hook → approval → sandbox
Tool output quay lại model
Core emit Event cho frontend
Canonical state được append vào rollout
Test harness thay model thật bằng deterministic SSE
```

Các ý đáng học nhất:

- `Op/EventMsg` là boundary giữa frontend và engine.
- `TurnContext/StepContext` giữ request view nhất quán.
- World state được inject incremental thay vì nối prompt tùy tiện.
- Tool spec và tool runtime được tách riêng.
- Approval và sandbox là hai lớp độc lập.
- Rollout append-only giúp resume/fork và audit.
- SSE integration harness làm agent behavior deterministic trong test.
