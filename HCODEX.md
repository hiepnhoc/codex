# hcodex — code-agent harness cá nhân (fork của openai/codex)

Branch `my-harness` trong repo này. Binary tên `hcodex`, tách hoàn toàn khỏi
`codex` của Codex CLI / ChatGPT Desktop app (dùng song song được).

## Khác gì so với codex gốc

| Thay đổi | File |
|---|---|
| Binary `hcodex` (thay vì `codex`) | `codex-rs/cli/Cargo.toml` |
| Home mặc định `~/.hcodex` (vẫn tôn trọng `CODEX_HOME`) | `codex-rs/utils/home-dir/src/lib.rs` |
| Provider built-in `local-proxy` và là provider **mặc định** | `codex-rs/model-provider-info/src/lib.rs` |
| Model mặc định `claude-sonnet-5.5` khi dùng `local-proxy` (đổi từ `claude-sonnet-5` ngày 09/10/2026 vì Kiro bỏ model cũ) | `codex-rs/model-provider-info/src/lib.rs` (`LOCAL_PROXY_DEFAULT_MODEL`), `codex-rs/core/src/config/mod.rs` |
| Branding `OpenAI Codex` → `hcodex` | `codex-rs/tui/...`, `codex-rs/exec/...` |
| Check update + nút *Update now* trỏ về GitHub Release của fork (tag `hcodex-v*`), cập nhật bằng `install.sh` / `install.ps1` của release | `codex-rs/tui/src/updates.rs`, `update_action.rs`, `update_versions.rs`, `codex-rs/cli/src/doctor/updates.rs` |
| `/model` liệt kê model từ provider (`GET {base_url}/models`, mọi provider OpenAI-compatible) + effort low/medium/high/xhigh | `codex-rs/model-provider/src/local_proxy_models.rs`, `codex-rs/models-manager/src/manager.rs` |
| Catalog của proxy được chuẩn hoá thành prompt harness trung lập cho mọi model (GPT, Claude, Gemini, Qwen, GLM…), kể cả catalog file và prompt mặc định "running in the Codex CLI… led by OpenAI" (20/11/2026); cache model gắn identity provider+auth (cơ chế upstream) và không trộn catalog OpenAI bundled vào | `codex-rs/model-provider/src/local_proxy_models.rs`, `codex-rs/model-provider/src/provider.rs`, `codex-rs/models-manager/src/manager.rs` |
| `/provider` trong TUI: thêm provider (id, base URL, key) → kiểm tra `/models` → chọn model → ghi config + profile; `/model` gộp model của mọi provider, chọn là đổi provider **giữ nguyên hội thoại** (fork thread); `/provider use <id> [model]` là đường tắt | `codex-rs/tui/src/bottom_pane/provider_setup_view.rs`, `codex-rs/tui/src/chatwidget/provider_setup.rs`, `codex-rs/tui/src/app/provider_setup.rs` |
| ~~Thread chạy tiếp trên provider nó đã ghi khi profile/`/model` chọn provider khác~~: từ sync 19/11/2026 upstream tự làm việc này (`e115d5f90d`), bản vá hcodex đã gỡ. Cờ `[features] thread_keeps_provider` còn lại như cờ rỗng để config cũ không báo lỗi | `codex-rs/features/src/lib.rs` (cờ rỗng), test canh `thread_on_other_configured_provider_stays_writable` trong `codex-rs/app-server/src/config_manager_provider_tests.rs` |
| HTTP 429 từ provider **không phải OpenAI** được retry ở lớp HTTP, tôn trọng `Retry-After` (codex gốc không retry 429) | `codex-rs/model-provider-info/src/lib.rs` (`retry_429`), `codex-rs/codex-client/src/retry.rs` (1 dòng gọi) + `retry/hcodex_rate_limit.rs` |
| `server_is_overloaded`, SSE rate-limit và HTTP `usage_limit_reached` từ proxy được retry cấp turn (2s→30s/lần, tối đa `stream_max_retries`) thay vì kết thúc turn giả; OpenAI chính chủ giữ semantics upstream | `codex-rs/core/src/session/turn.rs`, `codex-rs/core/src/responses_retry.rs` (+ test `core/tests/suite/hcodex_overload_retry.rs`) |
| Tool kiểu `namespace` (multi-agent v2 `collaboration`, MCP `mcp__<server>`) được **trải phẳng** thành function `<namespace>__<tool>` cho provider không phải OpenAI (proxy/gateway bỏ qua tool type lạ → model mất tool); call trả về được map lại đúng handler | `codex-rs/core/src/tools/flat_namespaces.rs`, `codex-rs/core/src/tools/router.rs`, `codex-rs/model-provider-info/src/capabilities.rs` (`responses_extensions`) |
| Item `agent_message` (task gửi cho subagent, final answer gửi về cha) được render thành message `user` thuần cho provider không phải OpenAI (proxy bỏ item lạ → subagent không nhận task) | `codex-rs/core/src/client_common.rs` (`render_agent_messages_as_plain_text`), `codex-rs/core/src/client.rs` |

Diff code so với upstream nhỏ (≈15 file, phần lớn là file mới) → rebase lên upstream dễ.
Sau sync 07/10/2026 nhiều hook harness đã được thay bằng cơ chế upstream: cache catalog
theo identity provider+auth, `with_provider_catalog()` (không trộn catalog OpenAI),
`Retry-After` native ở lớp HTTP, `[model_providers.x.capabilities]` của upstream
(`external_web_access`, `remote_compaction`; hcodex thêm `responses_extensions`) — cấp
provider, bổ sung chứ không trùng `model_overrides.toml` (cấp model).

Lưu ý: codex chỉ hỗ trợ **OpenAI Responses API** (`wire_api = "chat"` đã bị
xoá). Provider nào chỉ có `/chat/completions` (Anthropic, Gemini, Groq…) phải đi
qua gateway nói được `/v1/responses` (proxy local ở dưới, LiteLLM, OpenRouter…).

## Nguyên tắc: một harness riêng, lõi vẫn theo upstream (chốt 19/11/2026)

Mục tiêu của repo này: **một** harness cá nhân gồm CLI, app desktop, plugin, proxy, không tách
nhiều repo để khỏi phải bảo trì. Ràng buộc đi kèm: lõi harness (`codex-rs/`) tiếp tục nhận cập
nhật từ openai/codex, vì một người không phát triển nổi toàn bộ lõi; ý tưởng riêng được thêm
vào miễn là **không làm lần sync sau conflict ở phần lõi**.

Vì vậy mỗi ý tưởng mới đặt ở chỗ ít đụng upstream nhất, theo thứ tự:

1. **Ngoài repo, trong `~/.hcodex`**: skill, role agent, profile, hook, plugin. Không bao giờ conflict.
2. **Thư mục hoặc file mới mà upstream không có**: `hcodex-app/`, `docs/hcodex-skills/`,
   `scripts/…`, file Rust mới (`local_proxy_models.rs`, `flat_namespaces.rs`, `provider_setup*.rs`).
   Rebase không conflict vì upstream không sửa các đường dẫn này.
3. **Sửa file của upstream**: chỉ khi hai cách trên không làm được. Giữ móc thật nhỏ (vài dòng gọi
   sang file mới), đặt sau cờ `[features]` mặc định tắt, có test nằm trong gate của
   `sync-upstream.sh`, và ghi một dòng vào bảng "Khác gì so với codex gốc".

Trước khi vá lõi, xem upstream đã hoặc sắp có chưa. Hai ví dụ từ lần sync 19/11: bản vá
`thread_keeps_provider` bị upstream thay thế sau hai tuần, và `/provider` giờ trùng một phần
với màn quản lý provider của upstream.

Số đo lần sync 19/11 (880 commit upstream): 75 commit harness, chỉ 12 commit đụng file bị
conflict, 16 file conflict; `hcodex-app/` và `docs/hcodex-skills/` không gây conflict nào.

### Diện tích vá lõi và cách giữ nó nhỏ (rà 19/11/2026)

Đo bằng `git diff --numstat --diff-filter=M main my-harness`: harness sửa **76 file của
upstream** (khoảng 1.940 dòng thêm, 88 dòng bớt) và thêm 370 file riêng. 26 trong 76 file là vá
TUI (khối sub-agent, `/subagents`, bộ chọn `/model`); khi app desktop thay được các màn đó thì
nhóm này bỏ được.

Conflict tăng theo khoảng cách sync, không theo số file vá: 880 commit upstream → 16 file
conflict; 72 commit → 1 file. 16 file lần 19/11 chia theo tính năng: chọn model/provider 6, hai
cờ `plugin_marketplace_auto_upgrade` + `agent_role_provider` 4, bảng `/subagents` 2, đổi tên +
`ProviderCredential` 2, `thread_keeps_provider` 2 (đã bỏ).

Quy ước áp dụng từ 19/11/2026 cho mọi bản vá lõi:

- **Test của hcodex không viết nối vào file test của upstream.** Đặt trong file riêng
  `<tên>_hcodex_tests.rs` cạnh file nguồn, móc bằng 3 dòng ngay sau `mod tests;` của upstream:
  `#[cfg(test)] #[path = "<tên>_hcodex_tests.rs"] mod hcodex_tests;`. Gate lọc theo
  `hcodex_tests`. Hàm phụ trợ private của file test upstream thì chép lại bản nhỏ vào file
  riêng. Đã chuyển: `models-manager/src/manager`, `core/src/agent/role`,
  `app-server/src/config_manager`, `core/src/client_common`, `model-provider/src/provider`,
  `core/src/config` (`config_hcodex_tests.rs`), `core/src/responses_retry`. Chưa chuyển vì dựa
  nặng vào helper của upstream và nằm giữa file: 2 test trong `core/src/tools/spec_plan_tests.rs`,
  1 test trong `core/tests/suite/model_switching.rs`.
- **Khối code lớn không nằm nhờ trong file upstream.** Tách ra module con, file upstream chỉ
  giữ dòng `mod` và dòng gọi: `models-manager/src/config/model_overrides.rs` (trước là 371
  dòng trong `config.rs` vốn 12 dòng), `codex-client/src/retry/hcodex_rate_limit.rs`.
- **File sinh tự động không trộn tay**: `core/config.schema.json`, `Cargo.lock`, `*.snap`. Khi
  rebase conflict ở các file này, `sync-upstream.sh` lấy bản upstream, ghi tên file vào
  `.git/hcodex-regen`, rồi sinh lại trước gate (`codex-write-config-schema`, test TUI với
  `INSTA_UPDATE=always`, `cargo metadata`) và commit "Regenerate generated files after sync".
- **Lịch sử nhánh gọn**: mỗi vùng lõi chỉ do một commit đụng tới, nếu không rebase sẽ conflict
  lại ở từng commit cũ. Ngày 19/11 gộp 77 commit harness thành 1 commit squash (lịch sử cũ ở tag
  `harness-pre-squash-20261119T145649Z`); lịch sử `hcodex-app/` giữ nguyên vì không đụng lõi.

`codex-client` có `test = false` trong `[lib]` (của upstream), nên 3 test trong
`retry/hcodex_rate_limit.rs` không bao giờ chạy trong `cargo test`; muốn chạy thì tạm đổi thành
`test = true` rồi `cargo test -p codex-client --lib -- hcodex_rate_limit` (19/11: 3/3 qua).

## App desktop: `hcodex-app/` (gộp vào repo 19/11/2026)

Trước đây là repo riêng `~/github/codex-ide` (không có remote). Gộp vào đây bằng
`git format-patch --root` bên đó rồi `git am --directory=hcodex-app
--exclude='hcodex-app/src/protocol/*'` bên này: 6 commit giữ nguyên tác giả và ngày, 7 commit chỉ
sinh lại kiểu giao thức bị bỏ. Đổi tên từ `codex-ide` thành `hcodex` (binary `hcodex-app`,
bundle `com.hiepln.hcodex-app`).

App **không link mã của lõi**: vỏ Tauri gọi `hcodex app-server` làm tiến trình con và nói
JSON-RPC. Thứ duy nhất lấy từ lõi là bộ kiểu TypeScript trong `hcodex-app/src/protocol/`, giờ
**không commit** mà do `scripts/gen-protocol.mjs` sinh từ binary hcodex đang cài ở đầu
`pnpm dev` / `pnpm build` (chỉ sinh lại khi binary đổi). Sau mỗi lần sync,
`sync-upstream.sh` tự chạy `pnpm build` ở đây: vừa sinh lại kiểu vừa để `tsc` báo chỗ giao thức đổi.

```bash
cd hcodex-app && pnpm install
pnpm tauri dev        # chạy app; pnpm tauri build để đóng gói
```

Có gì (đợt 1, 19/11):

| Phần | Dùng lệnh app-server nào |
|---|---|
| Tab Sessions: phiên gom theo project, tìm kiếm, mở lại đúng provider/model | `thread/list` (phải gửi `modelProviders: []`, không thì chỉ ra phiên của provider mặc định), `thread/resume` |
| Ô chọn model gộp mọi provider; đổi provider giữa chừng thì fork thread | `modelProvider/list`, `model/list { modelProvider }`, `thread/fork` |
| Cây Agents: Main + subagent, trạng thái, model, thời gian, lệnh đang chạy, đếm running/done | item `subAgentActivity` của thread cha, `thread/status/changed`, `turn/*`, `thread/read` |
| Bấm subagent để xem luồng của nó (chỉ xem) | event `item/*` gắn `threadId` của subagent |

Điều rút ra khi làm: subagent (multi_agent_v2) **không** có `thread/started`; nó xuất hiện qua
`subAgentActivity` trong thread cha và qua event mang `threadId` lạ. `modelProvider/list` của
upstream không liệt kê `local-proxy` và báo mặc định là `openai`; app đi vòng bằng `model/list`
không kèm provider, chưa sửa trong lõi.

Phát triển giao diện không cần vỏ desktop (app-server từ chối WebSocket có header `Origin`, nên
đi qua proxy dev chỉ nhận đúng origin của trang dev):

```bash
hcodex app-server --listen ws://127.0.0.1:4599
cd hcodex-app && HCODEX_APP_WS=ws://127.0.0.1:4599 pnpm dev   # mở http://localhost:1420/?cwd=<thư mục>
```

**Đợt 2 (20/11/2026): bố cục ba cột, chế độ Chat và Code.** Chốt với user: cách chia Chat/Code
của Claude, khung bên trong của DeepSeek Harness, dòng hoạt động gọn kiểu Codex.

| Phần | Cách làm |
|---|---|
| Nút Chat/Code đầu sidebar; mỗi chế độ giữ phiên đang mở riêng | Chat = thread chạy ở `~/.hcodex/chat` (`initialize.codexHome` + `fs/createDirectory`), `sandbox: "read-only"`, `approvalPolicy: "never"`, kèm `developerInstructions`; Code = `workspace-write` + `on-request` như trước. Mở lại hoặc fork phiên nào cũng gửi lại quyền của chế độ đó (Code: `workspace-write`, Chat: chỉ đọc), vì app-server không tự giữ sandbox đã ghi (sửa 20/11, xem "Bộ test của harness") |
| Sidebar: New session, Plugins, Skills, MCP servers, Providers, rồi Workspaces (Code) hoặc History theo ngày (Chat) | `thread/list` với `cwd: <thư mục chat>` cho Chat; Code lọc bỏ thư mục chat ở client |
| Cột giữa: mỗi việc agent làm là một dòng (Thought, lệnh, file sửa `+N -M`, sub-agent, tool), bấm để xem chi tiết; ô nhập có chọn model và % context | `thread/tokenUsage/updated` (`last.totalTokens / modelContextWindow`) |
| Cột phải: Changes, Files (cây + editor), Terminal, dưới cùng là Agents | Changes = `git diff HEAD` + file untracked qua `command/exec` (`src/lib/git.ts`), đọc lại khi xong lượt và khi `fs/changed`; không phải repo git thì dùng `turn/diff/updated` |
| Bốn trang chỉ đọc thay chỗ khung chat | `plugin/list`, `skills/list`, `mcpServerStatus/list`, `modelProvider/list` + catalog của ô chọn model |

Kiểm tra trên app-server thật qua browser pane (model `claude-haiku-5-5` trên `hibox`): Chat trả
lời và được ghi `read-only`/`never`; Code tạo và sửa file trong workspace tạm, Changes hiện đúng 2
file, Files mở được file, Terminal chạy lệnh; 2 sub-agent chạy song song hiện dải "2 subagents
running", danh sách Agents và xem được từng agent.

Điều rút ra đợt 2:

- `[agents] default_subagent_model` (đang là `claude-sonnet-5.5`, tên của `local-proxy`) không tồn
  tại trên provider khác, nên phiên đổi sang `hibox` gọi `spawn_agent` là lỗi `Unknown model`. App
  truyền `config: { "agents.default_subagent_model": <model của phiên> }` khi `thread/start` và
  `thread/fork` trên provider khác provider mặc định. CLI vẫn cần profile như cũ.
- Tên class CSS của khung ngoài không được trùng tên chế độ (`chat`): `.chat` là class của cột
  chat, gắn nhầm lên `.layout` làm vỡ lưới.
- Chưa có: render markdown cho câu trả lời, nút "Tiếp tục trong Code" từ Chat, lọc plugin theo
  loại cho Chat, bật/tắt plugin và sửa provider ngay trong app (các trang hiện chỉ đọc).

**Đợt 3 (20/11/2026): hoàn thiện giao diện.** User chê bản đợt 2 "thô" so với DeepSeek Harness.
So hai bên cạnh nhau thì khung ba cột đã đúng, cái kém là lớp hoàn thiện. Đã làm, tất cả trong
`hcodex-app/src/`, không thêm thư viện:

| Phần | Thay đổi |
|---|---|
| Nền tảng (`app.css`) | Màu theo biến, **sáng/tối theo hệ thống** (`prefers-color-scheme` + `color-scheme`); sidebar sáng hơn cột chat, viền mảnh; chữ 13.5–14.5px, dòng 30–32px; thanh cuộn mảnh (trước là thanh trắng mặc định); một màu nhấn xanh |
| Sidebar | Logo, nút New session dạng viên, icon cho từng mục; workspace là thư mục có mũi tên gập, phiên thụt vào; thời gian chỉ hiện khi rê chuột; ô tìm và ô thêm thư mục ẩn sau icon; phiên chưa có tên hiện "Untitled" mờ thay cho "(untitled)" |
| Chat | Tin của user là bong bóng bên phải; câu trả lời **render Markdown** (`Markdown.tsx` tự viết: heading, danh sách lồng, bảng, quote, code block có nút copy, link mở ngoài app; dựng node React trực tiếp nên không chèn được HTML); dòng Thought/lệnh có mũi tên gập; file agent sửa hiện thành thẻ; ba chấm "Working" khi agent đang bận mà chưa có chữ; nút copy câu trả lời khi rê chuột |
| Ô nhập | Thẻ bo tròn có viền sáng khi focus; nút gửi tròn màu nhấn; **ô chọn model tự vẽ** (`ModelPicker.tsx`: gõ để lọc theo model hoặc provider, ↑↓ Enter, nhóm theo provider, "Custom model…"); dòng trạng thái bên dưới: chế độ quyền, số token, thanh % context |
| Cột phải | Tab có icon và gạch chân màu nhấn; cây file có icon thư mục/file tô màu theo đuôi; tab editor có icon, chấm chưa lưu, thanh đường dẫn; **Changes là từng khung theo file** (`DiffView.tsx`: tên file, `+N -M`, dòng thêm/xoá tô nền, gập được, nút mở file) thay cho chữ diff thô trong Monaco; Monaco và terminal dùng cùng màu nền với app ở cả hai giao diện (`lib/theme.ts`) |

Kiểm trên app-server thật qua browser pane (dark và light, `claude-haiku-5-5` trên `hibox`): Chat
trả về mẫu Markdown đủ loại và render đúng; Code tạo file, chạy lệnh, sửa README, Changes hiện 3
khung file, Files mở được file; trang Providers và Skills. `pnpm build` và `harness-test.sh -k SC`
qua. Chưa nhìn tận mắt: cửa sổ Tauri thật, dải sub-agent và thẻ xin duyệt với màu mới (chỉ đổi CSS).

Chưa làm trong đợt 3: thanh tiêu đề liền cửa sổ kiểu macOS (`titleBarStyle: Overlay`, cần quyền
kéo cửa sổ và phải thử trên cửa sổ thật), tab Trajectory, tô màu cú pháp trong code block của
câu trả lời, gộp nhiều dòng Thought/lệnh liên tiếp thành một dòng tóm tắt.

Chưa làm: gói proxy vào app, đóng gói trong workflow `hcodex-release`.

## Yêu cầu

- Rust toolchain: repo pin `1.95.0` trong `codex-rs/rust-toolchain.toml`
  (rustup tự tải khi build lần đầu).
- Proxy Responses API đang chạy ở `http://127.0.0.1:8181/v1`
  (`GET /v1/models` để xem model có sẵn: claude-*-5, gpt-5.6-*, …).

## Build & cài

```bash
cd ~/github/codex/codex-rs

# V8 cho code-mode host: crate `v8` cần lib tĩnh prebuilt do OpenAI host
# (asset trên denoland/rusty_v8 không có cho bản này -> 404). Tải 1 lần:
D=~/.cargo/.rusty_v8/codex-v150.4.0; mkdir -p $D
B=https://github.com/openai/codex/releases/download/rusty-v8-v150.4.0
T=aarch64-apple-darwin; P=ptrcomp_sandbox_release
( cd $D && curl -fsSL -O $B/librusty_v8_${P}_${T}.a.gz \
        && curl -fsSL -O $B/src_binding_${P}_${T}.rs \
        && curl -fsSL -O $B/rusty_v8_${P}_${T}.sha256 \
        && shasum -a 256 -c rusty_v8_${P}_${T}.sha256 )
export RUSTY_V8_ARCHIVE=$D/librusty_v8_${P}_${T}.a.gz
export RUSTY_V8_SRC_BINDING_PATH=$D/src_binding_${P}_${T}.rs
# (phiên bản v8 xem trong codex-rs/Cargo.lock; đổi tag/version khi upstream nâng cấp)

# release (khuyên dùng; lần đầu 15–30 phút, sau đó incremental nhanh)
cargo build --release --bin hcodex --bin codex-code-mode-host
# cài: copy vào ~/.hcodex/bin (độc lập với target/, xoá target thoải mái) rồi symlink lên PATH;
# code-mode host phải nằm cạnh hcodex (codex tìm nó trong cùng thư mục). Script sync làm y vậy.
mkdir -p ~/.hcodex/bin && cp -p target/release/{hcodex,codex-code-mode-host} ~/.hcodex/bin/
ln -sf ~/.hcodex/bin/hcodex ~/.cargo/bin/hcodex
ln -sf ~/.hcodex/bin/codex-code-mode-host ~/.cargo/bin/codex-code-mode-host

# hoặc debug (build nhanh hơn, binary to hơn, chạy chậm hơn)
cargo build --bin hcodex
ln -sf ~/github/codex/codex-rs/target/debug/hcodex ~/.cargo/bin/hcodex
```

`~/.cargo/bin` đã có trong PATH (vì `cargo` chạy được). Mở tab terminal mới
(hoặc `hash -r`) rồi kiểm tra:

```bash
which hcodex && hcodex --version
```

Mỗi lần sửa code harness chỉ cần `cargo build --release --bin hcodex` lại —
symlink tự trỏ vào binary mới, không cần cài lại.

## Bản dựng sẵn cho Mac + Windows: GitHub Release (07/11/2026)

Không cần build trên từng máy nữa. Sửa source ở máy nào cũng được (Mac hay Windows), push
`my-harness`, đánh tag `hcodex-vX.Y.Z` → GitHub Actions (runner của GitHub, fork public nên
miễn phí) build **cả 2 bản** và đăng lên
<https://github.com/hiepnhoc/codex/releases>:

| Asset | Nội dung |
|---|---|
| `hcodex-aarch64-apple-darwin.tar.gz` | `hcodex`, `codex-code-mode-host` (Mac Apple Silicon) |
| `hcodex-x86_64-pc-windows-msvc.zip` | `hcodex.exe`, `codex-code-mode-host.exe`, 3 helper sandbox Windows |
| `install.sh`, `install.ps1`, `SHA256SUMS.txt` | installer + checksum |

Workflow: `.github/workflows/hcodex-release.yml` (chạy khi push tag, hoặc bấm *Run workflow*
trong tab Actions và nhập version). Nó ghi version từ tag vào `codex-rs/Cargo.toml` **chỉ trong
lúc build** (repo vẫn `0.0.0`) để `hcodex --version` ra số thật và check update hoạt động;
bản build từ source (`0.0.0`) không bao giờ check update.

```bash
# phát hành: từ my-harness đã push
git tag hcodex-v0.1.0 && git push origin hcodex-v0.1.0
# ~1–3 giờ trên runner miễn phí (lần đầu lâu nhất, có cache cargo cho lần sau)
```

Cài lần đầu / cập nhật tay:

```bash
# Mac
curl -fsSL https://github.com/hiepnhoc/codex/releases/latest/download/install.sh | sh
HCODEX_RELEASE=0.1.0 sh -c "$(curl -fsSL https://github.com/hiepnhoc/codex/releases/download/hcodex-v0.1.0/install.sh)"  # bản cụ thể
```

```powershell
# Windows (PowerShell thường, không cần Admin)
irm https://github.com/hiepnhoc/codex/releases/latest/download/install.ps1 | iex
```

Installer tải asset + `.sha256`, kiểm checksum, backup binary cũ vào `~/.hcodex/backup`, cài
vào `~/.hcodex/bin` (Mac symlink sang `~/.cargo/bin` hoặc `~/.local/bin`; Windows thêm
`%USERPROFILE%\.hcodexin` vào PATH user), xoá `models_cache*.json`. Trên Windows, exe đang
chạy được rename thành `.old` rồi mới ghi exe mới (nên *Update now* từ trong hcodex vẫn được).

Tự cập nhật: hcodex (bản release, không phải `0.0.0`) check
`api.github.com/repos/hiepnhoc/codex/releases/latest` tối đa 1 lần / 20 giờ, có bản mới thì
hiện prompt lúc khởi động; chọn *Update now* là nó chạy đúng installer trên khi thoát. Tắt bằng
`check_for_update_on_startup = false`.

Lưu ý Windows native: hooks, `scripts/*.sh`, `ocr-safe.sh` của harness là bash → cài
**Git for Windows** để có `bash` trên PATH; sandbox dùng helper Windows đi kèm zip. Bản
Linux/WSL2 không còn trong release (build từ source theo mục dưới nếu cần).

## Cách cũ: cài trên Windows qua WSL2 (05/11/2026, thay bằng mục trên)

Dùng **WSL2 Ubuntu**, không build native Windows: script (`scripts/*.sh`, `ocr-safe.sh`,
hooks), skills và symlink đều là bash/POSIX; V8 prebuilt cho `x86_64-unknown-linux-gnu`
có sẵn trên release `rusty-v8-v152.2.0` của openai/codex (bản `.a.gz` cho
`x86_64-pc-windows-msvc` không có).

```powershell
# PowerShell (Admin), một lần
wsl --install -d Ubuntu
```

```bash
# trong Ubuntu (WSL)
sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev git curl python3 python3-pip unzip
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source ~/.cargo/env
curl -LsSf https://astral.sh/uv/install.sh | sh                      # uvx cho MCP jira
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs   # hc-agents viewer

git clone -b my-harness https://github.com/hiepnhoc/codex.git ~/github/codex
cd ~/github/codex/codex-rs
D=~/.cargo/.rusty_v8/codex-v152.2.0; mkdir -p $D
B=https://github.com/openai/codex/releases/download/rusty-v8-v152.2.0
T=x86_64-unknown-linux-gnu; P=ptrcomp_sandbox_release
( cd $D && curl -fsSL -O $B/librusty_v8_${P}_${T}.a.gz && curl -fsSL -O $B/src_binding_${P}_${T}.rs \
        && curl -fsSL -O $B/rusty_v8_${P}_${T}.sha256 && sha256sum -c rusty_v8_${P}_${T}.sha256 )
export RUSTY_V8_ARCHIVE=$D/librusty_v8_${P}_${T}.a.gz
export RUSTY_V8_SRC_BINDING_PATH=$D/src_binding_${P}_${T}.rs   # cho cả 2 export vào ~/.bashrc
cargo build --release -j 4 --bin hcodex --bin codex-code-mode-host   # 20–40 phút
mkdir -p ~/.hcodex/bin && cp -p target/release/{hcodex,codex-code-mode-host} ~/.hcodex/bin/
ln -sf ~/.hcodex/bin/hcodex ~/.cargo/bin/hcodex
ln -sf ~/.hcodex/bin/codex-code-mode-host ~/.cargo/bin/codex-code-mode-host
hcodex --version
```

**Mang cấu hình từ Mac sang** (không mang sessions/sqlite/log):

```bash
# trên Mac: -h để copy skill thật thay vì symlink vào ~/.codex/skills
cd ~/.hcodex && tar -chzf ~/hcodex-config.tgz config.toml *.config.toml AGENTS.md hooks.json \
  agents skills rules provider-credentials jira.env proxy 2>/dev/null
# chép ~/hcodex-config.tgz sang Windows (\\wsl$\Ubuntu\home\<user>\ hoặc scp), rồi trong WSL:
cd ~/.hcodex && tar -xzf ~/hcodex-config.tgz
sed -i "s#/Users/hiepln/.cargo/bin/hcodex#$HOME/.cargo/bin/hcodex#; s#/Users/hiepln/.local/bin/uvx#$HOME/.local/bin/uvx#; s#/Users/hiepln/#$HOME/#g" config.toml *.config.toml
```

Provider: `local-proxy` (Kiro `:8181`) và `hibox` (Fusebox `:8317`) chạy trên Mac, máy
Windows không có → dùng `cliproxy` (HTTPS, key nằm trong `config.toml`): `hcodex -p cliproxy`
hoặc đổi `model_provider = "cliproxy"` ở đầu `config.toml`. Role đang pin `local-proxy`/`hibox`
(`agents/design|plan|advisor|reviewer.toml`) phải đổi `model_provider = "cliproxy"` (model id:
`claude-opus-5-5-high`, `gpt-6.1-terra`, `gemini-3.8-flash-high`). Cùng mạng với Mac thì có
thể tunnel thay vì đổi: `ssh -N -L 8181:127.0.0.1:8181 -L 8317:127.0.0.1:8317 <user>@<mac>`.

Chưa test thật trên WSL (05/11/2026). Sandbox Linux của codex cần Landlock/seccomp; kernel WSL2
mới có Landlock, nếu lệnh báo lỗi sandbox thì chạy `hcodex --sandbox danger-full-access` hoặc
`-c sandbox_mode="danger-full-access"` tạm và báo lại. Cập nhật sau này: `cd ~/github/codex &&
git pull && scripts/sync-upstream.sh --build-only` (không có launchd, muốn tự động thì cron).

## Dùng hằng ngày (trong terminal IntelliJ hoặc bất kỳ terminal nào)

```bash
cd /path/to/project
hcodex                              # TUI, giống `codex`
hcodex -m claude-opus-5-thinking    # đổi model cho phiên này
hcodex exec "giải thích repo này"   # headless
hcodex exec "..." </dev/null        # trong script: đóng stdin, nếu không exec sẽ chờ stdin
hcodex app-server                   # backend JSON-RPC cho client/IDE khác
```

Không cần login, không cần `OPENAI_API_KEY`: mặc định đã trỏ vào proxy local.

## Cấu hình (`~/.hcodex/config.toml`)

Chạy được với **zero config**. Ví dụ tuỳ chỉnh:

```toml
model = "claude-opus-5"             # đổi model mặc định
model_context_window = 200000

[projects."/Users/hiepln/github/codex"]
trust_level = "trusted"             # bật project-local config/hooks/execpolicy
```

### Dùng chung skills / prompts với codex gốc (sửa lại 13/10/2026)

`hcodex` đọc 4 root skill: `~/.hcodex/skills` (r0), `~/.agents/skills` (r1, dùng
chung với Claude Code), `~/.hcodex/skills/.system` (r2) và skill của plugin
(r3, OpenViking). Bảng mô tả skill được chèn vào **mọi** request, nên số skill
và độ dài mô tả ảnh hưởng trực tiếp tới token và độ trễ.

Cách wiring hiện tại: `~/.hcodex/skills` là thư mục thật, mỗi skill là một
symlink sang `~/.codex/skills/<tên>` (bộ skill live của mày, `docs/open-skills`
trong repo chỉ là bản tham khảo có version). **Không** symlink nguyên thư mục
(`ln -sfn ~/.codex/skills ~/.hcodex/skills` khi thư mục đã tồn tại sẽ tạo link
lồng `~/.hcodex/skills/skills`, vẫn chạy nhưng path hiện ra là `r0/skills/...`).
Bỏ 11 skill đã có ở `~/.agents/skills` (`hyperframes*`, `media-use`,
`motion-graphics`, `gpt-image-2-style-library`) để không bị liệt kê 2 lần.

Kết quả đo trên rollout thật:

| | Trước | Sau |
|---|---|---|
| Skill trong bảng | 68 (11 trùng) | 57 (0 trùng) |
| Kích thước bảng mỗi request | ~47k ký tự ≈ 11,7k token | ~22k ký tự ≈ 5,5k token |

Dựng lại khi `~/.codex/skills` có skill mới:

```bash
cd ~/.hcodex/skills && for d in ~/.codex/skills/*/; do n=$(basename "$d"); [ -f "$d/SKILL.md" ] || continue
  case " gpt-image-2-style-library hyperframes hyperframes-animation hyperframes-audio hyperframes-cli hyperframes-core hyperframes-creative hyperframes-keyframes hyperframes-registry media-use motion-graphics " in *" $n "*) continue;; esac
  ln -sfn "$HOME/.codex/skills/$n" "$n"; done
```

**`daily-dev` làm router mặc định**: với codex, SKILL.md chỉ là mô tả "use when",
model tự quyết có đọc hay không; trong bảng 57 skill, một router chung không tự
được chọn (đã probe: không có dòng route). Fix: `~/.hcodex/AGENTS.md` chép từ
`docs/open-skills/AGENTS-snippet.md` ("Default to `daily-dev`…"). Sau đó probe
cùng task thấy model tự `sed` đọc `daily-dev/SKILL.md` rồi route (task nhỏ →
test-first, không design/worktree). Gọi tường minh `$daily-dev …` vẫn là cách
chắc nhất: model nêu rõ "đi theo daily-dev rồi tdd", áp cả rule worktree và
bước review OCR của pack. Skill có `agents/openai.yaml` với
`allow_implicit_invocation: false` (`zoom-out`, `setup-matt-pocock-skills`)
không hiện trong bảng, chỉ gọi được bằng `$tên`.

Trần token của bảng skill: `[skills] max_context_tokens = N` (tối đa 10.000),
mặc định 2% context window. Vượt trần thì codex **cắt mô tả rồi bỏ bớt skill**
kèm cảnh báo, nên không đặt thêm; 57 skill hiện nằm trong mức chấp nhận được.
Muốn tắt hẳn bảng skill cho một phiên: `-c skills.include_instructions=false`.

`~/.hcodex/prompts` có thể symlink sang `~/.codex/prompts` nếu muốn dùng chung.
Còn `config.toml`, `sessions`, `history` giữ riêng để không đụng ChatGPT app.

### Metadata và prompt riêng theo model

**Metadata tự lấy từ `/models` của proxy** (không cần khai tay): với provider
OpenAI-compatible, hcodex đọc thêm các field mà Kiro-Go (`~/github/Kiro-go`)
công bố cho từng model:

- `input_modalities` / `modalities.input` → model nhận text hay text+image
- `context_window` → cửa sổ context (Kiro-Go lấy từ `tokenLimits` của Kiro;
  branch `hcodex-model-metadata` của repo đó, cần rebuild + restart proxy)
- các id `<model>-effort-<low|medium|high|xhigh|max|none>` → gộp thành thang
  effort của `<model>` và **ẩn khỏi `/model`** (81 id → ~25 model), mức
  `medium` là mặc định nếu có, không thì mức đầu tiên

Thiếu field nào thì dùng mặc định cũ (context 1M, thang low/medium/high/xhigh,
text+image). `model_overrides.toml` bên dưới ghi đè lên tất cả.

`hcodex` tự đọc `~/.hcodex/model_overrides.toml` lúc khởi động. File này bổ
sung metadata còn thiếu từ proxy cho đúng từng model:

```toml
[models."claude-opus-5-thinking"]
context_window = 200000
default_reasoning_effort = "high"
supported_reasoning_efforts = ["medium", "high", "xhigh"]
input_modalities = ["text", "image"]
instructions_file = "prompts/claude-opus-5.md"

[providers.kr.models."claude-opus-5-thinking"]
context_window = 180000
instructions = "Prompt riêng khi model này chạy qua provider kr."
```

- `[models."<slug>"]` áp dụng cho model ở mọi provider; bảng
  `[providers.<provider-id>.models."<slug>"]` ghi đè từng field cho provider đó.
- Hỗ trợ `context_window`, `default_reasoning_effort`,
  `supported_reasoning_efforts`, `input_modalities`, và một trong `instructions`
  hoặc `instructions_file`. Path tương đối được tính từ `model_overrides.toml`.
- Thứ tự ưu tiên: catalog provider → model chung → model theo provider → giá trị
  explicit trong `config.toml`/CLI. `/model`, model switch và request đều dùng
  cùng metadata đã merge. Sửa file xong cần mở session mới.

Biến môi trường riêng của harness:

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `HCODEX_PROXY_URL` | endpoint Responses API của proxy | `http://127.0.0.1:8181/v1` |
| `HCODEX_PROXY_API_KEY` | bearer token nếu proxy yêu cầu | (không gửi auth) |
| `CODEX_HOME` | thư mục state/config | `~/.hcodex` |

### Đấu nối provider khác

Điều kiện cứng: provider phải nói được **OpenAI Responses API**
(`POST {base_url}/responses`) — codex đã xoá `wire_api = "chat"`. Provider chỉ
có `/chat/completions` hoặc API riêng (Anthropic, Gemini, Groq, DeepSeek…) thì
đi qua gateway LiteLLM/OpenRouter. `/model` luôn tự lấy danh sách từ
`GET {base_url}/models` của provider đang active.

**Đã khai sẵn trong `~/.hcodex/config.toml`** — chỉ cần set key là dùng:

| Provider | Cách bật | Ghi chú |
|---|---|---|
| `local-proxy` | (mặc định, không cần gì) | proxy `:8181`, 16 model claude/gpt |
| `hibox` | key trong `~/.hcodex/provider-credentials/hibox.token` (0600, đọc qua `hcodex provider-credential hibox`) | proxy local `:8317`, 27 model (gpt-6-*, gemini-3.x, claude-*); `hcodex -p hibox` = gpt-6-sol; có trong `/model` gộp (thêm 20/10/2026) |
| `openrouter` | `export OPENROUTER_API_KEY=sk-or-...` | Responses API native (đã verify); ~427 model; list model không cần key, chạy turn mới cần |
| `litellm` | chạy LiteLLM ở `:4000` (xem dưới) | gateway sang Anthropic/Gemini/Groq/DeepSeek… |
| `azure` | bỏ comment trong config, điền resource + `AZURE_OPENAI_API_KEY` | có `query_params.api-version` |
| `openai` | built-in; login hoặc `OPENAI_API_KEY` | |
| `ollama` / `lmstudio` | built-in; `localhost:11434` / `:1234` | |
| `amazon-bedrock` | built-in; cần AWS creds | |

Lưu ý (20/10/2026): provider khai key bằng `auth.command` (cách wizard `/provider` lưu
key vào `provider-credentials/<id>.token`) trước đây **không liệt kê được `/models`**
khi provider bắt buộc auth ở endpoint đó (Hibox trả 401) → `/model` trống, cảnh báo
"Model metadata … not found". Đã sửa (2 phần, `codex-rs/model-provider/src/local_proxy_models.rs`): endpoint catalog áp
header auth giống request Responses (cả cho danh sách gộp), và provider command-auth
giờ có `identity` (tên + URL + hash lệnh, không lộ token) — trước đó trả `None` nên
manager không phân biệt "chưa lấy" với "đã lấy", `model/list` trả 0 model. Kiểm chứng:
`hcodex -p hibox` với key trong credential file → `/model` 44 model của hibox.

**Thêm provider ngay trong TUI: `/provider`** (tính năng riêng của hcodex)

```
hcodex
> /provider                       # hỏi lần lượt: id → base URL → API key (Enter để bỏ qua)
> /provider groq https://api.groq.com/openai/v1           # không key: có thể nhập 1 dòng
```

**Status line hiện provider (04/11/2026)**

Upstream có sẵn item `provider` (`provider: <id>`) cho `[tui] status_line`; đã đặt nó đầu
dòng trong `~/.hcodex/config.toml` để phân biệt `claude-opus-5-5` của hibox với
`claude-opus-5.5` của kr sau khi `/model` đổi provider (item đọc `model_provider_id` của
thread đang hiển thị nên đổi theo fork). Sửa tại chỗ bằng `/statusline` nếu muốn bỏ.

**Nhiều provider trong một hội thoại: `/model` gộp (15/10/2026)**

Config vẫn tách từng provider (`[model_providers.<id>]`, key và URL riêng),
nhưng `/model` gộp model của **mọi** provider trong config thành một danh sách,
mỗi dòng gắn tag provider:

```
claude-opus-5.5         [local-proxy]   (đang dùng)
gpt-6-sol               [cliproxy]      via cliproxy — switches this conversation…
gemini-3.8-flash-high   [cliproxy]
anthropic/claude-…      [openrouter]
```

Chọn model của provider khác → hội thoại chạy tiếp bằng provider đó, giữ đủ
context, không cần session mới. Cơ chế bên dưới: thread được fork
(`thread/fork` của upstream nhận `model_provider` + `model` khác, copy toàn bộ
history); trong TUI không thấy gì khác ngoài một dòng "Now using … via …". Hệ
quả duy nhất: `/resume` có thêm thread cũ trước lúc đổi. Đã test thật hai
chiều local-proxy (Claude) ↔ cliproxy (gpt-6-sol): model mới nhớ đủ nội dung cũ.

Chọn provider nào được gộp và lọc model (16/10/2026), trong `~/.hcodex/config.toml`:

```toml
[tui]
model_picker_providers = ["local-proxy", "cliproxy"]      # bỏ dòng = mọi provider trong config trừ built-in upstream (openai, ollama, lmstudio, bedrock); [] = không gộp
model_picker_models = { cliproxy = ["gpt-6*", "gemini-3.8*"] }   # glob `*`, không phân biệt hoa thường; provider không có entry = lấy hết
```

Trong popup `/model` **gõ chữ để lọc** theo tên model hoặc provider (ví dụ gõ
`sol` hoặc `cliproxy`); vì vậy phím số không còn chọn nhanh được, dùng ↑↓ + Enter.
Model đang dùng được chọn sẵn khi mở.

Chi tiết:
- Lúc mở `/model`, hcodex gọi `GET /models` của các provider khác **song song**,
  timeout 3s/provider, cache 5 phút. Provider lỗi (không có key, không chạy)
  hiện một dòng mờ "`<id>` unavailable: lý do", không chặn popup.
- Provider cần đăng nhập OpenAI/AWS (`openai`, `amazon-bedrock`) không được
  liệt kê chéo. Ẩn một provider khỏi danh sách gộp:
  `[model_providers.<id>.capabilities] list_models = false`.
- Effort của model mới về mặc định của nó, chỉnh lại bằng `/model`.
- Những `/new` sau đó trong cùng process dùng provider vừa chọn.
- Đường tắt gõ tay: `/provider use <id> [model]` (hoặc `/provider <id> <model>`);
  "Use it now" trong wizard `/provider` cũng chuyển ngay tại chỗ thay vì mở
  thread mới.
- Item reasoning của model cũ vẫn nằm trong history; proxy không hiểu thì bỏ
  qua. OpenAI chính chủ nhận reasoning mã hoá của model khác có thể báo lỗi —
  khi đó dùng `/new`.

Sau khi nhập, hcodex gọi `GET {base_url}/models` để kiểm tra kết nối và hiện
danh sách model cho mày chọn (gõ để lọc); nếu provider không có `/models` thì
cho gõ tay tên model. Cuối cùng chọn 1 trong 3:

- **Use it now** — lưu profile và mở ngay thread mới trên provider/model đó
  (mặc định trong `config.toml` giữ nguyên; các `/new` sau trong phiên này cũng
  dùng provider mới)
- **Make it the default and use it now** — như trên, thêm ghi `model_provider`/`model`
  vào đầu `config.toml` để các phiên sau cũng dùng
- **Save profile only** — giữ thread hiện tại, dùng sau bằng `hcodex -p <id>`

Kết quả ghi vào:

- `~/.hcodex/config.toml` → `[model_providers.<id>]` (name, base_url,
  `wire_api = "responses"`; nếu có key thì chỉ chứa command auth, không chứa secret)
- `~/.hcodex/provider-credentials/<id>.token` → API key, file owner-only (`0600` trên Unix)
- `~/.hcodex/<id>.config.toml` → profile (`model_provider`, `model`)
- nếu chọn "mặc định": thêm `model_provider`/`model` ở đầu `config.toml`

Chạy lại `/provider` với cùng id thì cập nhật đè. Ô nhập key được mask; key không
được nhận trong dạng lệnh một dòng để tránh rơi vào history. Muốn dùng biến môi
trường thay cho credential file thì sửa provider: xoá bảng `auth`, thêm
`env_key = "X"`.

**Chuyển provider bằng profile** (khuyên dùng) — mỗi profile là 1 file
`~/.hcodex/<tên>.config.toml` (format mới của codex; `[profiles.x]` trong
`config.toml` là legacy, để chung sẽ bị lỗi "cannot be used while ... legacy"):

```bash
hcodex -p proxy        # local-proxy, claude-opus-5-thinking, effort high (= mặc định)
hcodex -p sonnet       # local-proxy, claude-sonnet-5.5, effort medium
hcodex -p openrouter   # OpenRouter, anthropic/claude-fable-5.1 (cần OPENROUTER_API_KEY)
hcodex -p litellm      # LiteLLM :4000, claude-fable-5.1
hcodex -p openrouter exec "..." </dev/null   # profile dùng được cho mọi subcommand
```

Tạo profile mới: viết file `~/.hcodex/<tên>.config.toml` chứa các key thường
(`model_provider`, `model`, `model_reasoning_effort`, `approval_policy`…), ví dụ:

```toml
# ~/.hcodex/gemini.config.toml
model_provider = "openrouter"
model = "google/gemini-3.8-pro"
model_reasoning_effort = "medium"
```

Không dùng profile thì vẫn đổi tạm bằng flag:

```bash
hcodex -c model_provider=openrouter -m anthropic/claude-fable-5.1
```

Đặt mặc định thì set `model_provider` + `model` ở đầu `config.toml`. Trong TUI
đổi model bằng `/model` như thường (danh sách theo provider đang active).
Thiếu key sẽ báo rõ, ví dụ `ERROR: Missing environment variable: OPENROUTER_API_KEY`.

**LiteLLM gateway** — khi muốn cắm thẳng key Anthropic/Gemini/Groq/DeepSeek:

```bash
pip install 'litellm[proxy]'
cat > ~/litellm.yaml <<'YAML'
model_list:
  - model_name: claude-fable-5.1
    litellm_params: { model: anthropic/claude-fable-5.1, api_key: os.environ/ANTHROPIC_API_KEY }
  - model_name: gemini-3.8-pro
    litellm_params: { model: gemini/gemini-3.8-pro, api_key: os.environ/GEMINI_API_KEY }
  - model_name: deepseek-v4
    litellm_params: { model: deepseek/deepseek-chat, api_key: os.environ/DEEPSEEK_API_KEY }
YAML
litellm --config ~/litellm.yaml --port 4000
# rồi: hcodex -c model_provider=litellm -m claude-fable-5.1
```

Khai provider mới hoàn toàn thì theo mẫu:

```toml
[model_providers.myprovider]
name = "My Provider"
base_url = "https://api.example.com/v1"   # phải có POST {base_url}/responses
env_key = "MY_API_KEY"                    # bỏ nếu không cần auth
wire_api = "responses"
# tuỳ chọn:
# http_headers = { "X-Custom" = "value" }
# query_params = { "api-version" = "2025-04-01-preview" }   # Azure
# request_max_retries = 4
# stream_idle_timeout_ms = 300000
```

## Multi-agent (bật v2 ngày 09/10/2026)

Codex có sẵn multi-agent: tool `spawn_agent` / `send_message` / `wait_agent` /
`list_agents` / `resume_agent` / `interrupt_agent` / `close_agent`; TUI có
`/agents` (command center), `/subagents` (chuyển giữa subagent), `/side` (hội
thoại phụ). Chỉ cần bảo model tách việc ("tách thành 3 subagent…"), nó tự spawn.

Đã bật trong `~/.hcodex/config.toml`:

```toml
[features]
multi_agent_v2 = true            # v1 bật sẵn; v2: roster/vai trò, mailbox, wait/resume

[agents]
default_subagent_model = "claude-sonnet-5.5"    # subagent dùng model rẻ hơn cha (phải có trong /models của provider)
default_subagent_reasoning_effort = "medium"
max_concurrent_threads_per_session = 3          # mỗi subagent = 1 luồng request tới proxy
```

Flag còn ở trạng thái under-development, chưa bật: `multi_agent_v2_dynamic_tools`,
`agent_message_board`, `model_catalog_in_context`, `defer_mailbox_preemption`.
Lưu ý: qua cliproxy/Kiro mỗi subagent nhân thêm tải (3–6s/request, quota tài
khoản); giữ `max_concurrent_threads_per_session` ≤ 3. OpenViking hooks chỉ chạy
trên thread chính; subagent vẫn có MCP `search`/`read` của OpenViking.

### Đội agent kiểu oh-my-opencode: role + skill `$orch` (dọn lại 22/10/2026)

Ba tầng, không trộn:
- **Role** (`~/.hcodex/agents/<role>.toml`, cơ chế agent roles của upstream, tự phát hiện) = *ai chạy*:
  model, effort, `developer_instructions` của một con. Không chứa thứ tự việc.
- **Skill** (`~/.hcodex/skills/<tên>/SKILL.md`) = *làm thế nào*: workflow, bước, rẽ nhánh. Skill điều khiển role qua `spawn_agent(agent_type=...)`.
- **Profile** (`-p …`) = provider/model/sandbox của phiên. Không còn profile `orch`; orchestrator là bất kỳ phiên nào mày gõ `$orch`.

| Role | Model | Chỉ đọc | Việc |
|---|---|---|---|
| `explore` | gemini-3.8-flash-high, low | có | tra cứu nhanh, trả `file:line` |
| `research` | gpt-6-sol, high | có | options / tradeoff / rủi ro / khuyến nghị, có bằng chứng |
| `plan` | gpt-6-sol, high | có | PLAN: task đánh số, scope, acceptance criteria, test strategy, phụ thuộc, rủi ro |
| `dev` | gemini-3.8-flash-high, medium | không | làm đúng một task, chạy test, trả CHANGE REPORT |
| `qc` | gpt-6-sol, high | có | nghiệm thu theo criteria, chạy test, `VERDICT: QC: PASS/FAIL` + findings |

Subagent luôn cùng provider với cha nên model trong role phải có trong catalog của
provider đang dùng (hibox, cliproxy có đủ). `[agents] default_subagent_model` trong profile
hibox/cliproxy = `gpt-6-sol` (mặc định `claude-sonnet-5.5` chỉ có ở local-proxy).

**Workflow nằm trong skill `$orch`** (`~/.hcodex/skills/orch/SKILL.md`): phân loại
(câu hỏi → explore/research; đổi code → plan trước, trừ sửa vặt một file; việc lớn đưa mày
duyệt plan) → từng task `dev` → `qc` → PASS sang task sau, FAIL thì `followup_task` cùng dev
rồi cùng qc, tối đa 3 vòng → báo cáo chỉ gồm điều agent đã xác nhận. Tối đa 2 dev song song,
4 agent tổng; con lỗi thì followup chính nó, không spawn con không có role.

```
hcodex -p hibox -m gpt-6-sol        # hoặc -p cliproxy; model của phiên = orchestrator
> $orch Thêm endpoint GET /contracts/{id}/status vào esign-service, có test
> $daily-dev …                       # việc nhỏ, làm trong phiên như bình thường
```

Theo dõi từng con: `/subagents` hoặc `Alt+←/→`. Subagent kế thừa sandbox của phiên: TUI
mặc định workspace-write là đủ; `hcodex exec` phải thêm `-s workspace-write`.

Đã test (khi còn ở dạng profile + skill `hcodex-dev-qc`, logic giống hệt): task
"Stats mean/median/mode + test + README" → dev gemini → qc gpt-6-sol bắt `__pycache__`
ngoài phạm vi → sửa → PASS, 13 test, 314s, ~72k token. Bài học đã ghi vào skill: orch tự
lên plan thay vì gọi `plan`, và spawn con không role khi dev trả thiếu → giờ cấm cả hai.

### `$daily-dev` chia việc theo role, mỗi role chạy trên provider riêng (27/10/2026)

Thói quen của mày: mở `$daily-dev` với model mạnh để check source, nhận Jira, lập plan; code
lặt vặt thì gemini-3.8 làm tốt; task to phải tự đổi model rồi `/review` lại → thủ công. Giờ
`$daily-dev` bản hcodex tự chia việc (mục "Delegated Execution (hcodex)" trong
`~/.hcodex/skills/daily-dev/SKILL.md`), và **mỗi role tự chọn provider**:

| Pha | Ai | Role file → `model` @ `model_provider` |
|---|---|---|
| route, scan, hỏi lại, worktree, test cuối, báo cáo | model chính của session | mặc định `claude-opus-5.5` trên kr (`model` trong `config.toml`, profile `kr`); `/model` chọn gì dùng nấy |
| brainstorming | model chính nếu đang là opus, không thì spawn `design` (`fork_turns="all"`) | `design.toml` → claude-opus-5.5 @ local-proxy (kr) |
| writing-plans | model chính nếu đang là opus, không thì spawn `plan` (`fork_turns="all"`) | `plan.toml` → claude-opus-5.5 @ local-proxy |
| code từng task (kể cả bug nhỏ) | `dev` | `dev.toml` → gemini-3.8-flash-high @ cliproxy |
| review bằng OCR delegation (rule 12) | `reviewer` | `reviewer.toml` → gpt-6.1-terra @ cliproxy |
| simplify sau khi mọi task PASS | `simplify`, rồi `reviewer` kiểm lại một lần | `simplify.toml` → gemini-3.8-flash-high @ cliproxy (mày chốt 27/10; reviewer kiểm lại nên đủ) |
| `REVIEW: FAIL` | `followup_task` lại đúng dev với FINDINGS → dev sửa → reviewer kiểm lại; tối đa 3 vòng | |
| `$orch` | `explore` gemini @ cliproxy, `research`/`qc` gpt-6.1-terra @ cliproxy, `plan` opus @ kr | |
| tra tài liệu/API lạ trước khi code | `docs` (read-only, trả SOURCE/API/EXAMPLE, dev nhận nguyên văn) | `docs.toml` → gemini-3.8-flash-high @ cliproxy |
| ý kiến thứ hai (advisor) | `advisor` (`fork_turns="all"`) ở 3 mốc: trước khi chốt plan khi model chính không phải opus; cùng một finding/lỗi fail 2 lần; trước báo cáo hoàn thành task nhiều bước. `STOP` = dừng hỏi mày | `advisor.toml` → claude-opus-5.5 @ kr |

Đổi model/provider của một pha = sửa hai dòng trong `~/.hcodex/agents/<role>.toml`, không build:

```toml
model = "gpt-6.1-terra"
model_provider = "cliproxy"     # id trong [model_providers]; Kiro = "local-proxy"
```

**Sửa core để làm được việc này** (`core/src/agent/role.rs`, bật bằng feature flag):

```toml
[features]
agent_role_provider = true      # hcodex: role file được phép đổi model_provider
```

codex gốc ép subagent dùng provider của session (`child_config.rs`: `config.model_provider =
turn.provider`), lớp override của role chỉ có model/effort/instructions, và test upstream
`apply_role_cannot_expand_parent_authority` cấm role đổi provider. hcodex thêm
`model_provider` vào `AgentRoleOverrides`; khi flag bật, `build_next_config` tra
`model_providers[id]` và gán `model_provider`/`model_provider_id` cho config của agent con
(id không có → "agent type is currently not available"); flag tắt (mặc định) thì bỏ qua như
upstream. Ghi chú "This role's model is set to…" trong tool spec có thêm provider. Test:
`agent::role::tests::hcodex_apply_role_*`. Tên model theo catalog của provider đó: Kiro gọi
`claude-opus-5.5`, cliproxy/hibox gọi `claude-opus-5-5`.

**Model chính không tự sửa code.** Lần đầu chạy (28/10) opus tự sửa 2 template vì reasoning
"tweak CSS nhỏ → ngoại lệ edit nhỏ". Skill giờ có "hcodex execution contract" ngay đầu: mọi
sửa code/test/template/config đi qua `dev`, kể cả việc nhỏ; **không có ngoại lệ theo kích
thước** (test 16:06 cho thấy ngoại lệ "một dòng" cũng bị model vin vào); chỉ tự sửa khi câu
của mày có chữ "tự làm" / "làm trực tiếp", một điều kiện kiểm tra cơ học thay vì đánh giá.
Test 16:09 trên repo tạm: `Implementer: dev → reviewer`, dev sửa, reviewer PASS vòng đầu.
"direct execution" = bỏ bước plan, vẫn giao dev; route
announcement phải có `Implementer: dev → reviewer`. Review-only cũng do `reviewer` làm (29/10:
opus tự review vì contract mới chỉ nói về sửa file); tự review chỉ khi mày gõ "tự review".
Pha scan bị giới hạn (codemap + ~5 file,
hơn thì spawn `explore`; không tự render/build để "đo"). Nếu vẫn thấy nó tự sửa, gõ "giao dev".

**Đo 02/11/2026 trên ticket thật (PAD-662 + HTML PAD-665)**: dev gemini 29 phút/149 tool call nhưng
150 message (kể lể từng bước), 17 output >6 KB; reviewer terra 44 phút/60 call, 47 output >6 KB vì
`nl -ba` cả file, 23 s mỗi bước = 43 phút chờ model; main opus 7 lần `wait_agent` mỗi lần kèm một
câu "vẫn đang chạy" trên session đã 660 triệu token tích luỹ. Sửa: `dev` không narrate, đọc có địa
chỉ (`sed -n`, `rg -n`), test một lần cuối; `reviewer` bắt đầu từ `git diff`, không dump cả file,
ngân sách ~15 phút rồi trả verdict ghi "not checked (budget)"; skill: chờ im lặng, checkpoint 30
phút bằng `followup_task` hỏi tiến độ (không ngắt, không respawn), mỗi ticket một session mới.
Không đặt trần số tool call: task to hợp lệ cần nhiều lệnh, chia nhỏ ở plan chứ không chặn dev.

`design`/`plan` không nói chuyện trực tiếp với mày: nó trả QUESTIONS/DESIGN/PLAN, model chính
chuyển nguyên văn cho mày, lấy câu trả lời rồi `followup_task`. Gate duyệt thiết kế, worktree,
protected action giữ nguyên; `yolo` vẫn thay gate duyệt như trước. OCR không có LLM thứ hai:
`reviewer` chính là model suy luận, gọi `ocr-safe.sh delegate preview/rule` rồi đọc diff; model
chính không chạy OCR nữa nên không tốn context cho diff. Reviewer lỗi (provider down) → thử
lại một lần, rồi model chính tự review và ghi "reviewer fallback: self".

Lưu ý: một turn `hcodex exec` chỉ spawn 1 agent tốn ~99k token ở model chính (bảng skill +
OpenViking context), nên đừng dùng `$daily-dev` cho việc một dòng. hibox (= Fusebox
`~/github/Fusebox`, :8317) có account `codex` chết token 27/10 (`401 invalidated oauth token`
→ mọi gpt-6 trả 429/404); không dùng trong workflow này; chữa khi cần bằng
`./target/debug/fusebox login codex`.

### Review song song bằng subagent, model khác model đã code (21/10/2026)

Kịch bản: code bằng model rẻ (gemini) rồi muốn model mạnh (gpt-6-sol) review mà không
tốn token quét lại source. Subagent **cùng provider** với cha nhưng chọn được model
khác trong catalog của provider đó (hibox và cliproxy đều có gemini + gpt-6-sol).

Skill local `~/.hcodex/skills/hcodex-parallel-review/SKILL.md` (`$hcodex-parallel-review`):
cha lấy `git diff` một lần, spawn 2–3 subagent `fork_turns="none"` (không kế thừa
context dài của cha) với model mày chỉ định, mỗi con một trọng tâm (correctness /
tests / conventions), chỉ đọc file trong diff, trả findings `[severity] file:line`;
cha `wait_agent` rồi gộp. Đã test: cha gemini-3.8-flash-high trên hibox spawn 2 con
gpt-6-sol, tổng ~8 phút (con "tests" chạy `cargo test` nên lâu; bảo nó bỏ qua nếu không cần).

```
hcodex -p hibox -m gemini-3.8-flash-high
> …code xong…
> $hcodex-parallel-review review uncommitted changes with 2 subagents on gpt-6-sol: correctness and tests
```

Lưu ý `[agents] default_subagent_model` phải tồn tại trong catalog của provider đang
dùng; `config.toml` đặt `claude-sonnet-5.5` (local-proxy), nên profile `hibox` và
`cliproxy` ghi đè bằng `gpt-6-sol`. Sai model thì spawn báo "Unknown model … Available
models: …" và cha tự chọn lại. Song song = nhanh hơn, không rẻ hơn: mỗi con là một
request stream riêng (diff + hướng dẫn ≈ vài nghìn token mỗi con).

### Vì sao cần sửa core: tool `namespace` và item `agent_message` bị proxy bỏ rơi

Upstream gửi tool multi-agent v2 (và tool MCP) dưới dạng **một** tool
`{"type":"namespace","name":"collaboration","tools":[spawn_agent, send_message,
wait_agent, …]}` — tool type chỉ OpenAI hiểu. Kiro-Go, cliproxy, LiteLLM… chỉ
dịch `type = "function"` nên âm thầm bỏ cả namespace → model trả lời
"không có tool spawn_agent" dù flag đã bật (đã kiểm chứng bằng cách bắt request
body: `collaboration` và `mcp__openviking_memory` đều là `namespace`).

hcodex xử lý ở core (`core/src/tools/flat_namespaces.rs`):

- Provider **không phải OpenAI** (`requires_openai_auth = false`, không phải
  Bedrock): mỗi tool con được quảng cáo như function phẳng
  `<namespace>__<tool>` — cùng cách đặt tên code mode của upstream — ví dụ
  `collaboration__spawn_agent`, `collaboration__wait_agent`,
  `mcp__openviking_memory__search`. Marker `encrypted` (chỉ OpenAI) bị bỏ.
- Khi model gọi `collaboration__spawn_agent`, router map lại thành tool
  `collaboration/spawn_agent` trước khi dispatch → handler, hook, lịch sử
  giữ nguyên như upstream.
- Task cho subagent và final answer gửi về cha đi bằng item
  `{"type":"agent_message","author":"/root","recipient":"/root/x","content":[…]}`
  — cũng chỉ OpenAI hiểu; proxy bỏ → subagent chào "Hi! What can I help…" thay
  vì làm việc (đã gặp). hcodex render item này thành message `user` thuần
  (`core/src/client_common.rs`), giữ nguyên text "Message Type: NEW_TASK /
  Sender / Payload". Phần `encrypted_content` thực chất là plaintext (không có
  cấu hình mã hoá phía server) nên được ghép vào nguyên văn.
- Provider OpenAI / Bedrock: không đổi gì (vẫn gửi `namespace` + `agent_message`).
- Ép thủ công:

```toml
[model_providers.<id>.capabilities]
responses_extensions = true   # provider hiểu đủ dialect OpenAI; false = ép trải phẳng + text
```

Kiểm tra nhanh: `hcodex exec "dùng spawn_agent tạo 1 subagent trả lời pong,
wait_agent rồi báo kết quả"` phải thấy subagent chạy thay vì "không có tool".

## Codemap cho monorepo (20/10/2026, chỉ local)

Vì sao: soi phiên `digital-monorepo` lớn nhất (412 lệnh tool) thấy 111 lệnh chỉ để mò cấu
trúc (`rg --files`, `ls`, `sed -n`), 0 lần dùng tool OpenViking. OpenViking recall không
thay được bước định hướng vì nó chọn theo câu hỏi; repo 32 service không có AGENTS.md
nên phiên nào cũng quét lại.

Cách làm: dùng cơ chế `AGENTS.override.md` của codex (ưu tiên hơn `AGENTS.md`, tự nạp
mọi file trên đường từ project root tới cwd, tổng ≤ 32 KB `project_doc_max_bytes`):

- `digital-monorepo/AGENTS.override.md` (~19 KB): luật dùng map, chỉ mục 26 service
  (stack + mục đích), tổng quan repo (họ service, quy ước Go/Quarkus/Node, giao tiếp
  Dapr/REST/gRPC, infra CodeBuild/ECR, DB theo service, git/Jira prefix, "where to start").
- `<service>/AGENTS.override.md` (≤ 8 KB mỗi cái): purpose, stack, entrypoint, layout
  thật, integrations, config, lệnh build/test, "common tasks: muốn làm X thì sửa Y",
  gotchas. Tự nạp khi cwd nằm trong service; từ root thì map bảo agent `cat` nó.
- Chỉ local: tên file nằm trong `.git/info/exclude` (cùng chỗ `.claude`, `.opencode`),
  `git status` không thấy, không commit cho team.

Tạo bằng 4 agent đọc repo song song (chỉ đọc), ghép lại bằng script; làm lại khi
layout đổi: xoá các file `AGENTS.override.md` rồi chạy lại quy trình (hoặc dùng skill
`$codemap` của pack cho từng service). Map có ghi vị trí credential commit nhầm trong
repo (không chép giá trị) — nên xử lý.

### `daily-dev` bản riêng của hcodex + codemap tự sinh (22/10/2026)

`~/.hcodex/skills/daily-dev/` giờ là **bản chép riêng** (trước là symlink sang
`~/.codex/skills/daily-dev`, sửa là dính cả codex gốc). Pack gốc giữ nguyên. Bản hcodex
thêm mục **Repo Orientation** chạy trước mọi route:
1. Có `AGENTS.override.md` → đọc, đi thẳng vào file; cấm `rg --files`/`ls -R` cả service.
2. Chưa có → một lượt định hướng có giới hạn rồi tự viết `AGENTS.override.md` (≤ 8 KB,
   kèm `<module>/AGENTS.override.md` cho module đang làm), thêm tên file vào
   `.git/info/exclude`, báo mày một dòng. Lần sau vào repo đó không mò lại.
3. Map cũ: dòng đầu mỗi map ghi `<!-- codemap: generated <ngày> at commit <sha> -->`;
   agent so với `git rev-parse HEAD`, khác thì `git diff --stat <sha>..HEAD -- <module>`;
   module đổi nhiều thì làm mới phần map đó trước; gặp đường dẫn/lệnh sai thì sửa map
   ngay trong lượt và báo "codemap updated". Map là gợi ý, code là sự thật.
Map của `digital-monorepo` đã được đóng dấu commit `aedda8cf2` (20/10).

### SRS cho mỗi chức năng: skill `$to-srs` (18/11/2026)

Mục tiêu: chức năng mới nào cũng có một file SRS theo mẫu công ty (`SRS-Template.docx`),
và file đó khớp với code đã làm chứ không phải với ý định ban đầu.

Skill local `~/.hcodex/skills/to-srs/` (thư mục thật, không symlink sang `~/.codex`):

| File | Việc |
|---|---|
| `SKILL.md` | quy trình: chốt phạm vi → gom bằng chứng → điền mẫu → `reviewer` soát → báo cáo |
| `TEMPLATE.md` | mẫu docx chuyển sang Markdown, giữ đúng tên và thứ tự mục, sơ đồ bằng Mermaid |
| `agents/openai.yaml` | `allow_implicit_invocation: false` → không nằm trong bảng skill, không tốn token mỗi request |

Bản chép có version nằm ở `docs/hcodex-skills/to-srs/`. Bản live là bản trong
`~/.hcodex`; sửa ở đó rồi chép lại vào repo.

**Dùng**: đứng ở nhánh của chức năng, gõ `$to-srs PAY-123`. File ra ở
`docs/srs/PAY-123-<tên>.md` (repo có quy ước khác thì theo quy ước đó). Chưa có file thì
tạo bản 0.1 trạng thái Nháp; có rồi thì sửa tại chỗ, tăng phiên bản 0.1 và thêm một dòng
lịch sử. Gọi lúc nào cũng cùng một logic, nên làm xong mới gọi vẫn ra đúng cái đã làm.

**Phạm vi** (xác định cơ học): mã ticket lấy từ câu lệnh → tên nhánh → commit. Khoảng
thay đổi = `git merge-base HEAD <nhánh mặc định>`..`HEAD` cộng phần chưa commit. Nhánh đã
merge thì tìm bằng `git log --grep=<mã>`; không thấy thì hỏi một câu rồi dừng.

**Nguồn, mạnh trước yếu sau**: code trong khoảng thay đổi → migration → định nghĩa API →
file design/plan trong `.agents/tasks/` → hội thoại → ticket Jira (đọc qua MCP `jira`,
không ghi). Mục chưa có code thì lấy từ design và gắn dòng `_Theo thiết kế, chưa có code._`

**Luật cứng trong skill**:
- Mỗi mục kết bằng `<!-- nguồn: path:line -->`. Không dẫn được nguồn thì ghi
  `CẦN ĐIỀN: <cần gì>`, không đoán. Người review, đầu mối, ngưỡng cảnh báo thường rơi vào đây.
- Mục không liên quan ghi `Không áp dụng — <lý do>`, không xoá heading.
- DDL chép nguyên văn từ migration. Không chép secret dù có trong config.
- Chỉ mô tả repo đang đứng; phần của repo khác là `CẦN ĐIỀN` trừ khi mày chỉ đường dẫn.
- Không tự đặt trạng thái `Đã duyệt`; file đã duyệt mà đổi nội dung kỹ thuật thì về `Đang review`.
- SRS do model chính viết (cần lý do thiết kế trong phiên), không giao `dev`; `reviewer`
  soát SRS với diff, tối đa 2 vòng.

**Khác mẫu gốc** ba chỗ: thêm mục Phụ lục (quy tắc nghiệp vụ, sơ đồ trạng thái, bảng mã
lỗi; tự bỏ khi không có bằng chứng), mục Đặc tả API có thêm bảng endpoint mới/sửa, và
file ra là Markdown (chưa có bước xuất `.docx` hay đẩy Google Docs).

**Nối vào `$daily-dev` bản hcodex** (`~/.hcodex/skills/daily-dev/SKILL.md`, bản trước khi
sửa: `~/.hcodex/backup/daily-dev-SKILL.md.bak-20261118`):

| Chỗ | Thêm gì |
|---|---|
| Execution contract đầu file | design/plan, ADR và SRS do model chính viết; mọi sửa khác vẫn giao `dev` (trước đó dòng "docs edits → dev" mâu thuẫn với "Docs/ADR steps stay with you") |
| Bảng Classification | dòng `to-srs`, kèm đường dẫn `SKILL.md` vì skill bị ẩn khỏi bảng skill |
| Mandatory Rules, luật 13 | hễ cổng duyệt thiết kế của `brainstorming` đã chạy thì gọi `to-srs` hai lần: nháp sau khi duyệt, bản theo code thật trước báo cáo cuối. Kiểm tra cơ học: chỉ bỏ khi câu của mày có chữ "không cần SRS" |
| Recipe Non-Trivial Feature, API / UI Change | hai bước `to-srs` |
| Delegated Execution, luật 5 | brief của `reviewer` có đường dẫn SRS làm tiêu chí nghiệm thu: code lệch SRS là finding |
| Delegated Execution, luật 8 | bước SRS do model chính làm |
| Completion Report | dòng `SRS:` (đường dẫn + phiên bản + mục `CẦN ĐIỀN` / skipped / not required) |

Sửa lỗi, sửa vặt, refactor thuần không qua `brainstorming` nên không sinh SRS, trừ khi mày
gọi `$to-srs`.

**Cài trên máy khác** (bản hcodex của `daily-dev` không nằm trong repo; nó đi theo bước
"Mang cấu hình từ Mac sang", hoặc sửa tay theo bảng trên):

```bash
cp -R docs/hcodex-skills/to-srs ~/.hcodex/skills/
```

```powershell
Copy-Item -Recurse -Force docs\hcodex-skills\to-srs "$env:USERPROFILE\.hcodex\skills\"
```

Đã kiểm 18/11: `skills/list` của `hcodex app-server` trả về `to-srs` (`enabled`, scope
`user`, `errors: []`) và `daily-dev` vẫn nạp được. **Chưa** chạy thử với model trên một
chức năng thật.

## Memory + RAG cho repo lớn: OpenViking (07/10/2026)

Vấn đề: mỗi session mới lại phải quét các module trong `digital-monorepo` → tốn
token/thời gian. Giải pháp: [OpenViking](https://github.com/volcengine/OpenViking)
(context DB: memory + RAG + skills, AGPL-3.0) chạy local, gắn vào **hcodex qua
plugin hooks + MCP**; `~/.codex` không bị đụng.

Thành phần đã cài:

| Thành phần | Ở đâu | Chạy bằng |
|---|---|---|
| OpenViking server v0.4.23 | `uv tool install openviking`; config `~/.openviking/ov.conf`; data `~/.openviking/data` | launchd `ai.openviking.server` (port 1933, auth `api_key` từ 26/10/2026) |
| Embedding | Ollama `nomic-embed-text` (768d), binary `~/.local/bin/ollama` + `~/.local/lib/ollama` (tarball GitHub, brew fail) | launchd `com.ollama.serve` (127.0.0.1:11434) |
| VLM (tóm tắt L0/L1) + query planner | `claude-sonnet-5.5` qua proxy `http://127.0.0.1:8181/v1` (haiku bị `Input is too long`, xem bên dưới) | — |
| Plugin cho hcodex | `openviking-memory@openviking` (marketplace trong `~/.hcodex/config.toml`) | hooks: SessionStart / UserPromptSubmit / Stop / PreCompact / SessionEnd |
| CLI + plugin | `ov` và hook plugin đọc `~/.openviking/ovcli.conf` (url + `api_key` + account/user) | |

Lệnh hay dùng:

```bash
openviking-server doctor                 # kiểm tra config/model/embedding
ov status                                # server + hàng đợi task
ov tree viking://~/resources/            # cây resource đã index
ov find "esign callback flow"            # tìm ngữ nghĩa
ov task status <task_id>                 # tiến độ import
launchctl kickstart -k gui/$(id -u)/ai.openviking.server   # restart server
```

Index repo: CLI zip cả thư mục (kể cả `node_modules`) nên vượt giới hạn 512 MB —
dùng `git archive` lấy đúng file được track:

```bash
cd ~/github/digital-monorepo
git archive --format=zip -o /tmp/dm.zip HEAD
ov add-resource /tmp/dm.zip --to viking://~/resources/digital-monorepo \
  --ignore-dirs "node_modules,dist,build,server-build,.idea,.cache,.next,target,coverage,lib,public" \
  --exclude "*.lock,package-lock.json,*.min.js,*.map,*.png,*.jpg,*.svg,*.pdf,*.jar,*.wasm"
```

Import chạy nền (tóm tắt từng file/thư mục bằng haiku qua proxy); import lại cùng
`--to` sẽ refresh. Trong hcodex, lần đầu mở sẽ hỏi **trust hooks** → chọn "Trust all"
(`/hooks` để xem). Mỗi prompt sau đó được bơm `<openviking-context>` gồm profile,
memory liên quan và tóm tắt module liên quan; cuối turn transcript được ghi về
server để trích memory. Debug: `OPENVIKING_DEBUG=1` → `~/.openviking/logs/codex-hooks.log`.

### Kiểm tra tốc độ 20/10/2026 (hcodex "càng ngày càng chậm")

Đo một turn "Reply OK" trong `digital-monorepo`, tách theo pha từ rollout:

| Pha | Thời gian |
|---|---|
| Khởi động process (config, MCP jira+openviking, skills) | 2–6s |
| Hook SessionStart (sweep + profile) | 0.2–1.7s |
| Hook UserPromptSubmit (recall) | **1.2s ấm, 3–18s khi lạnh** |
| Model trả lời (claude-sonnet-5.5 qua Kiro) | 2.4–4s |
| Hook Stop (auto-capture) | 0.3s |

Nguyên nhân "lúc nhanh lúc chậm" là ở recall:
1. **ollama unload model embed sau 5 phút idle** (`keep_alive` mặc định); mỗi lần
   recall sau idle phải load lại nomic-embed-text 3–6s (server log:
   `embedding slow call … duration_ms=3500–5900`; `ollama.err.log` "loaded runners"
   5 lần/ngày). Fix: `OLLAMA_KEEP_ALIVE=-1` trong
   `~/Library/LaunchAgents/com.ollama.serve.plist` (model ~300 MB RAM, giữ thường trú).
2. **VLM claude-haiku-4.5 qua Kiro bị `Input is too long`** (AmazonQ
   `CONTENT_LENGTH_EXCEEDS_THRESHOLD`) khi OpenViking tạo working memory lúc commit
   → retry 3 lần rồi bỏ, memory không được rút trích. Fix: `vlm` và
   `query_planner` trong `~/.openviking/ov.conf` đổi sang `claude-sonnet-5.5`.

Không phải nguyên nhân: kho dữ liệu còn nhỏ (vectordb 112 MB, 267 memory, 1.158
session, 9.837 file resource), state dir 14 file, khối recall chèn vào prompt ~5k ký tự
(~1,2k token), bảng skill ~22k ký tự. Lưu ý thêm: phiên TUI để mở nhiều ngày thì
context tích luỹ hàng trăm nghìn token, model trả lời chậm dần là do context, không
phải OpenViking; `/new` hoặc `/compact` sẽ thấy nhanh lại.

### Cách dùng hằng ngày

**1. Index một repo bất kỳ (1 lệnh)** — làm 1 lần, và làm lại khi repo đổi nhiều:

```bash
scripts/ov-index-repo.sh ~/github/<repo>          # tên resource = tên thư mục
scripts/ov-index-repo.sh ~/github/<repo> ten-khac  # hoặc đặt tên
scripts/ov-index-repo.sh ~/github/<repo> --wait    # chờ tới khi tóm tắt xong
```

Script zip đúng file git track (bỏ `node_modules`, ảnh, jar, lock…), đẩy lên
`viking://~/resources/<tên>`; chạy lại cùng tên = refresh. Theo dõi: `ov status`
(Pending/In progress về 0 là xong). Repo lớn (20k file) mất ~15–20 phút.

**2. Dùng trong hcodex** — không cần làm gì thêm: mở `hcodex` trong thư mục repo,
hỏi như bình thường. Mỗi prompt, hook tự tìm memory + tóm tắt module liên quan và
bơm vào context; cuối turn transcript được lưu để lần sau nhớ. Mẹo:
- Muốn nó trả lời từ memory thay vì quét: hỏi thẳng, ví dụ *"Module nào xử lý X,
  dùng framework gì? Trả lời từ memory nếu đã có."*
- Muốn nó đào sâu một thư mục đã index: bảo nó dùng MCP tool `search`/`read` với
  URI `viking://~/resources/<repo>/<path>` (hook cũng gợi ý URI trong context).
- Memory theo **repo** (peer = git remote), nên clone/worktree khác cùng repo vẫn
  chung memory; repo chưa index vẫn có memory hội thoại (preferences, quyết định).

**3. Xem/tìm bằng CLI** (ngoài hcodex):

```bash
ov tree viking://~/resources/<repo> -L 2      # cây + tóm tắt từng thư mục
ov read viking://~/resources/<repo>/<dir>/.overview.md
ov find "luồng callback esign"                # tìm ngữ nghĩa trên mọi thứ đã index
ov ls viking://~/memories/                    # memory dài hạn của mày (identity, preferences…)
ov rm viking://~/resources/<repo>             # bỏ 1 repo
```

**Ảnh hưởng tốc độ** (đo 08/10/2026 trên máy này):

| Hook | Khi nào | Thời gian |
|---|---|---|
| SessionStart | mở session | ~0,2s |
| UserPromptSubmit (recall) | mỗi prompt, trước khi model chạy | **0,2–0,5s** (lần đầu sau restart server ~3,5s vì Ollama nạp model) |
| Stop (capture) | sau khi model trả lời | ~2s, không chặn |
| SessionEnd | thoát | ~0,3s |

Cộng ~900–1.600 token context/prompt (thường rẻ hơn nhiều so với để agent quét lại).
Hai knob đã chỉnh để đạt số trên:
- `~/.openviking/ovcli.conf` → `"plugin": {"recallCompress": "off", "recallTimeoutMs": 8000}`:
  tắt bước nén context bằng LLM (tốn ~12s/prompt, lợi không đáng), và trần 8s để server
  chậm không bao giờ treo prompt.
- `~/.openviking/ov.conf` → `"retrieval": {"enable_intent": false}`: tắt query planner
  (1 lượt gọi haiku ~3s/prompt). Bật lại nếu thấy recall kém với câu hỏi mơ hồ.
- `~/.hcodex/config.toml` → `[hooks.state."openviking-memory@openviking:hooks/hooks.json:<event>:<i>:0"]`:
  đã tắt 3 hook chạy **mỗi lần gọi tool** (`pre_tool_use` uri-guard, `post_tool_use`
  usage/track-lookup, `stop:1` usage/report; mỗi cái ~0,1s Node startup → turn có 30
  tool call mất thêm ~6s), và `trusted_hash` cho các hook còn lại để khỏi hỏi trust.
  Xem/đổi trong TUI bằng `/hooks`. **Từ sync 23/10/2026 upstream fingerprint cả thư
  mục plugin** (`trusted_content_hash`), plugin cache tự re-sync từ marketplace → mỗi
  lần plugin đổi nội dung, mọi hook bị từ chối im lặng (`hook: UserPromptSubmit Failed`
  trong `hcodex exec`, không còn `<openviking-context>`). Chữa: `/hooks` trong TUI
  hoặc headless `scripts/hc-approve-hooks.sh [--dry-run] <cwd>` (cùng đường app-server
  `hooks/list` + `config/batchWrite` như TUI). `scripts/harness-smoke.sh` cảnh báo
  khi có hook `modified`.
Tắt hẳn recall tạm thời: `OPENVIKING_AUTO_RECALL=0 hcodex`; tắt ghi transcript: `OPENVIKING_AUTO_CAPTURE=0`.

**4. Khi có vấn đề**: trong hcodex gõ `$ov-memory-doctor` (skill của plugin), hoặc
`openviking-server doctor`; log hook: `OPENVIKING_DEBUG=1` → `~/.openviking/logs/codex-hooks.log`.
Không thấy block `<openviking-context>` trong câu trả lời ⇒ xem mục proxy bên dưới.

**Lưu ý proxy Kiro-Go**: bản trước 07/10 **bỏ rơi message role `developer`** (OpenAI)
→ context của OpenViking (và `<skills_instructions>`, context per-turn của codex)
không tới model. Đã fix trong `~/github/Kiro-go` (branch `hcodex-model-metadata`,
commit "fold OpenAI developer messages"): developer ở đầu → system prompt, giữa/cuối →
ghép vào user turn gần nhất trong `<developer_instructions>`. Binary cũ giữ ở
`kiro-go.bak-20260909`; restart proxy: `launchctl kickstart -k gui/$(id -u)/com.hiepln.kiro-go`.
Kiểm tra nhanh: gửi `/v1/responses` có item role `developer` chứa 1 từ bí mật rồi hỏi lại.

Gỡ: `hcodex plugin remove openviking-memory@openviking && hcodex plugin marketplace remove openviking`,
`launchctl bootout gui/$(id -u)/ai.openviking.server`, xoá `~/.openviking`.

### Auth bằng API key, kho tri thức tập trung và cấu hình model (26/10/2026)

Mục tiêu: OpenViking là **kho tri thức tập trung** (memory + tóm tắt repo) dùng chung
cho mọi session hcodex; sau này đưa lên cloud cho pilot thì chỉ cần cấp key. Đã đổi
server từ `auth_mode = "dev"` sang `"api_key"` (backup `~/.openviking/ov.conf.bak-dev-mode`,
đổi lại chỉ cần copy đè và `launchctl kickstart -k gui/$(id -u)/ai.openviking.server`).

| Key | Ở đâu (0600) | Dùng cho |
|---|---|---|
| Root key (`server.root_api_key` trong `ov.conf`) | `~/.openviking/root.key` | admin API: tạo account/user, đổi config runtime, đăng nhập Studio quyền root |
| User key `default/default` (role admin) | `~/.openviking/user-default.key` và `~/.openviking/ovcli.conf` → `api_key` | `ov` CLI, hook plugin của hcodex, Studio |

Header là `Authorization: Bearer <key>` (hoặc `X-API-Key`). Không key → 401; user key
gọi `/api/v1/admin/*` → 403. Plugin hcodex không cần đổi gì: nó đọc `ovcli.conf`
(log `credentialSource":"ovcli","hasApiKey":true`), đã kiểm `hcodex exec` vẫn bơm
`<openviking-context>`.

**Cấp key cho người dùng pilot** (chạy trên máy chủ, cần root key):

```bash
ROOT=$(cat ~/.openviking/root.key); OV=http://127.0.0.1:1933
curl -s -X POST $OV/api/v1/admin/accounts -H "Authorization: Bearer $ROOT" \
  -H 'Content-Type: application/json' -d '{"account_id":"default"}'        # đã có → ALREADY_EXISTS, bỏ qua
curl -s -X POST $OV/api/v1/admin/accounts/default/users -H "Authorization: Bearer $ROOT" \
  -H 'Content-Type: application/json' -d '{"user_id":"hiep2","role":"user"}' # trả về "user_key"
curl -s -X POST $OV/api/v1/admin/accounts/default/users/hiep2/key -H "Authorization: Bearer $ROOT"  # cấp lại key
```

Người nhận chỉ cần `~/.openviking/ovcli.conf` `{"url":"http://<host>:1933","api_key":"<key>"}`
và cài plugin như mục trên. Lưu ý: memory nằm theo **user** (`viking://user/<id>/memories`,
`viking://user/<id>/peers/<repo>/…`, `viking://user/<id>/resources/<repo>`), nên muốn
pilot **thấy chung** memory/tóm tắt repo đã index thì cho họ dùng chung user `default`
(cùng key); user riêng = không gian riêng, phải index lại.

**Cấu hình embedding / VLM (model + URL + key) ở đâu**: **chỉ trong file**
`~/.openviking/ov.conf`, Studio không có trang sửa (đã kiểm bundle Studio 0.4.23:
VLM/Embedding chỉ hiện *đọc* ở Monitoring → tab Models). Mỗi model một block, sửa xong
`launchctl kickstart -k gui/$(id -u)/ai.openviking.server` rồi `openviking-server doctor`:

```json
"embedding": {"dense": {"provider": "ollama", "model": "nomic-embed-text",
                         "api_base": "http://127.0.0.1:11434/v1", "dimension": 768}},
"vlm":           {"provider": "openai", "model": "claude-sonnet-5.5",
                  "api_base": "http://127.0.0.1:8181/v1", "api_key": "<key proxy>"},
"query_planner": {"provider": "openai", "model": "claude-sonnet-5.5",
                  "api_base": "http://127.0.0.1:8181/v1", "api_key": "<key proxy>"}
```

Embedding qua Ollama local nên không có `api_key`; đổi sang API ngoài thì thêm
`api_key` vào `embedding.dense`, và đổi embedding model/dimension là phải index lại
toàn bộ resource. (Server còn lớp runtime config `GET/PATCH /api/v1/admin/configuration`,
root key, nhưng chưa dùng; file vẫn là nguồn chuẩn.)

**Đăng nhập Studio** `http://127.0.0.1:1933/studio/` → Settings → **Connection Settings**:
Server URL `http://127.0.0.1:1933`, *Root or Admin API Key* = `~/.openviking/root.key`
(để vào Users & Permissions: tạo user, copy/regenerate key), *User API Key* =
`~/.openviking/user-default.key`, Account `default`, User `default`. Chưa điền key thì
Home báo "Connection identity is unresolved".

**Đưa lên cloud sau này** (chỉ mình dùng + vài pilot): copy `~/.openviking/data` +
`ov.conf` lên máy mới, `uv tool install openviking` cùng version (0.4.23), đổi
`server.host` sang `0.0.0.0` và đặt sau reverse proxy có TLS, trỏ `vlm.api_base` /
`query_planner.api_base` sang LLM gateway mà máy chủ gọi được (Kiro-Go hiện là
127.0.0.1:8181 **của máy này**, lên cloud phải có endpoint OpenAI-compatible khác hoặc
tunnel ngược), Ollama cũng phải chạy cạnh server hoặc đổi `embedding` sang API ngoài
(đổi model ⇒ index lại). Phía client chỉ đổi `url` trong `ovcli.conf`.

### Đóng băng plugin cache: `plugin_marketplace_auto_upgrade = false` (26/10/2026)

Vì sao: xem "Sự cố thường gặp" → hook `plugin contents changed`. Upstream (codex) mỗi lần
khởi động TUI/app-server chạy thread `plugins-marketplace-auto-upgrade`: re-clone mọi
marketplace Git trong `[marketplaces]`, cài đè cache plugin nếu snapshot đổi. OpenViking
sửa plugin liên tục mà không bump version ⇒ hook chết im sau mỗi commit của họ.

hcodex thêm feature flag (mặc định `true` như upstream, diff core nhỏ):

```toml
[features]
plugin_marketplace_auto_upgrade = false   # không tự re-clone marketplace lúc khởi động
```

Code: `features/src/lib.rs` (`Feature::PluginMarketplaceAutoUpgrade`),
`core-plugins/src/manager.rs` (`PluginsConfigInput::marketplace_auto_upgrade`, gate trong
`maybe_start_plugin_startup_tasks_for_config`, log `configured marketplace auto-upgrade
disabled…`), `core/src/config/mod.rs` nối flag vào `plugins_config_input()`.

Quy trình cập nhật plugin thủ công (vài tuần một lần, hoặc khi OpenViking có fix mày cần —
xem commit trên `examples/codex-memory-plugin` của repo OpenViking trước):

```bash
scripts/hc-update-plugins.sh openviking ~/github/<repo>
#  = hcodex plugin marketplace upgrade openviking   (re-clone + cài đè cache)
#  + in danh sách file đổi và diff hooks.json / scripts/*.mjs để mày xem trước khi tin
#  + scripts/hc-approve-hooks.sh <repo>              (duyệt fingerprint mới)
#  + hcodex exec "Reply OK" → phải thấy "hook: … Completed"
```

Session đang mở phải `/new` hoặc mở lại. Nâng server OpenViking (`uv tool upgrade openviking`)
thì nâng plugin cùng lúc cho khớp. Bật lại hành vi upstream: xoá dòng flag hoặc đặt `true`.

## Cập nhật từ upstream (openai/codex)

Mô hình branch:

- `upstream` → `https://github.com/openai/codex` (nguồn), `origin` → fork của mày.
- `main` chỉ theo `upstream/main`, **không commit** vào đây.
- `my-harness` = `main` + các commit harness, luôn được **rebase** lên `main`
  (diff nhỏ, ít conflict). Mọi phát triển riêng đều commit vào `my-harness`.

Đồng bộ + rebuild bằng 1 lệnh:

```bash
scripts/sync-upstream.sh --check     # fetch + giả lập merge: tụt bao nhiêu commit, file nào sẽ conflict; không đổi gì
scripts/sync-upstream.sh --dry-run   # xem main tụt bao nhiêu commit, upstream đụng file harness nào
scripts/sync-upstream.sh             # fetch, ff main, rebase, build release, test gate, smoke, cài
scripts/sync-upstream.sh --no-build  # chỉ đồng bộ git
scripts/sync-upstream.sh --build-only  # sau khi tự sửa conflict: build + gate + cài
scripts/sync-upstream.sh --rollback  # cài lại binary đã backup ở ~/.hcodex/backup (build mới bị lỗi)
SKIP_TESTS=1 scripts/sync-upstream.sh  # bỏ qua cargo test (vẫn chạy smoke)
```

Phát hành bản dựng sẵn cho máy khác sau khi sync xong (xem "Bản dựng sẵn cho Mac + Windows"):
`git push origin my-harness && git tag hcodex-vX.Y.Z && git push origin hcodex-vX.Y.Z`.

Script bảo vệ mày thế nào:

- Trước khi rebase: tag `harness-pre-sync-<UTC>` trên `my-harness`. Sync hỏng thì
  `git rebase --abort && git reset --hard <tag>` là về y cũ.
- `rerere` bật: conflict đã resolve một lần sẽ tự resolve lại lần sau.
- Trước khi cài: backup binary đang dùng vào `~/.hcodex/backup/`, chạy unit test
  harness (`codex-model-provider`, `provider_setup`, `command_popup`), build release,
  rồi `scripts/harness-smoke.sh` trên binary **mới build**: version, danh tính trong
  request cho 3 họ model (không cần mạng), `/model` phải lấy list từ proxy, 1 turn
  `exec` qua proxy mặc định, và 1 turn thật cho từng dòng `provider model` trong
  `~/.hcodex/smoke-turns.txt`. Fail ở bước nào thì binary cũ vẫn nguyên, không
  symlink đè. Provider tự chết hoặc hết quota chỉ là WARN, không chặn cài (chi tiết
  ở mục "Sự cố thường gặp").
- Cảnh báo nếu `Cargo.lock` nâng `v8` khác với artifact V8 đang cache.
- File untracked (như `docs/open-skills/scripts/`) không chặn sync; chỉ file đã
  sửa chưa commit mới chặn.

**Sync tự động hằng tuần (22/10/2026)**: launchd `~/Library/LaunchAgents/com.hiepln.hcodex-sync.plist`
chạy `scripts/sync-upstream.sh --unattended` **mỗi ngày 02:07** (đổi từ hằng tuần 23/10/2026), log `~/.hcodex/log/sync.log`.
Chế độ `--unattended`: fetch → tag `harness-pre-sync-*` → ff `main` → rebase `my-harness`;
rebase **sạch** thì tự cài toolchain theo `rust-toolchain.toml` nếu thiếu, chọn V8 cache theo
`Cargo.lock` (`~/.cargo/.rusty_v8/codex-v<ver>`; thiếu thì dừng, exit 3, git đã sync), build
`-j2` nice 15, test gate, smoke, cài, push `my-harness`. Có **conflict** thì `rebase --abort`,
reset `my-harness` về tag, ghi danh sách file conflict vào log, exit 2; `main` vẫn đã lên
upstream, hôm sau chạy sync tay (hoặc nhờ agent) để sửa conflict. Tắt job:
`launchctl unload ~/Library/LaunchAgents/com.hiepln.hcodex-sync.plist`; chạy thử ngay:
`launchctl start com.hiepln.hcodex-sync`.

**Từ 19/11/2026 job đêm chỉ kiểm tra, không tự sync.** Job cũ (`--unattended`, tự rebase +
build + cài) bị gỡ sau 3 đêm conflict liên tiếp (lần chạy cuối 06/11). Job mới cùng label
`com.hiepln.hcodex-sync` chạy `scripts/sync-upstream.sh --check` lúc 02:07 (máy ngủ thì chạy khi
thức): fetch upstream, giả lập merge bằng `git merge-tree`, ghi kết quả vào
`~/.hcodex/sync-status.txt` và `~/.hcodex/log/sync-check.log`, hiện thông báo macOS
"upstream +N commit, M file conflict". Không đổi nhánh, không build. Exit 2 khi có file viết
tay sẽ conflict. Thấy số commit lớn dần hoặc bắt đầu có conflict thì chạy sync tay.

```bash
scripts/sync-upstream.sh --install-nightly     # tạo plist + nạp vào launchd
scripts/sync-upstream.sh --uninstall-nightly   # gỡ
cat ~/.hcodex/sync-status.txt                  # kết quả lần kiểm tra gần nhất
```

Sau khi cài binary mới, script tự chạy `pnpm build` trong `hcodex-app/` (nếu đã
`pnpm install`): kiểu giao thức được sinh lại từ binary vừa cài, build hỏng nghĩa là upstream
đổi thứ app đang dùng; log ở `~/.hcodex/log/hcodex-app-build.log`. Lỗi này chỉ cảnh báo, không
chặn việc cài.

**Máy thiếu RAM khi build**: supervisor của session (và macOS) kill cargo ở bước
link test TUI hoặc link binary release. Cách đã dùng ngày 12/10/2026: chạy gate
với `BUILD_JOBS=2`, bỏ test TUI (`SKIP_TESTS=1`, release build vẫn compile crate
TUI nên lỗi biên dịch vẫn lòi ra), và chạy script **tách khỏi session**
(`nohup … &` rồi poll log) thay vì background task của session.

**Lịch sử sync**

| Ngày | upstream/main | Số commit | Ghi chú |
|---|---|---|---|
| 20/11/2026 (tay, sau khi gộp lịch sử) | `583ec348cf` | 113 | Rebase 8 commit (1 squash + 7 của `hcodex-app`), **dừng 1 lần**: `core/src/guardian/reviewer_config.rs` (upstream tách `eligible_review_models`; giữ lời gọi của upstream rồi áp `model_overrides` lên kết quả). Port 1 chỗ: `fork_thread_at` thêm tham số `workspace_roots` → `tui/src/app/provider_setup.rs` truyền như upstream (`b9afb4f99b`). Gate: core `--test all` 9, core `--lib` 38 (có `hcodex_tests`), models-manager/model-provider/model-provider-info/features qua; **nhóm TUI không link được** (xem dưới), chạy `SKIP_TESTS=1 --build-only` cho phần còn lại. Release build 33m47s, smoke PASS, đã cài; `hcodex-app` build được với binary mới. |
| 07/10/2026 | `18e28fe1b9` | 1.530 | squash-sync, 19 file conflict (xem dưới) |
| 12/10/2026 | `2351d9e1b6` | 111 | rebase thường, 1 conflict `core/src/session/turn_context.rs` (upstream bỏ backend zsh vá → bỏ khối `UnifiedExecShellMode`); diff harness trước/sau sync giống hệt nhau (interdiff 0 dòng); 2 test Bedrock `credential_export` flaky dưới tải, chạy riêng pass |
| 19/11/2026 (tay; job đêm conflict 04–06/11 rồi ngừng hẳn từ 07/11) | `4389a526d5` | 880 | Rebase 75 commit harness, dừng 7 lần. Commit squash gốc conflict 7 file: `model-provider/src/provider.rs` (upstream `68334831d8` tách test sang `provider_tests.rs` và gom việc tạo models manager vào `models_manager_with_settings(ModelCatalogSettings)`; lấy file upstream rồi ghép lại nhánh `openai_compatible` → `LocalProxyModelsEndpoint` + `normalize_proxy_model_catalog` + `with_provider_catalog`, test `proxy_provider_normalizes_static_model_catalog_instructions` chuyển sang `provider_tests.rs`), `core/src/thread_manager.rs` (upstream thay `models_manager` bằng `model_catalog: ThreadModelCatalog`; giữ `models_manager_config` và gọi `model_catalog.manager.list_models_with_config`), `core/src/guardian/reviewer_config.rs` (upstream gom vào `resolve_catalog_review_model`; áp `model_overrides.apply_to_model` lên catalog trước `select_review_model`), `cli/src/main.rs` (upstream gỡ subcommand `stdio-to-uds`; chỉ giữ `provider-credential`), `exec` (thêm tham số `workspace_roots`, giữ branding), `model-provider/src/lib.rs` + `tui/src/app.rs` (giữ cả hai). Các lần dừng sau: `provider.rs` lặp lại (giữ bản đã ghép); `tui/chatwidget/model_popups.rs` (upstream thêm màn "Loading models…" khi catalog rỗng; hcodex vẫn mở picker ngay nếu đã có model của provider khác); cờ `plugin_marketplace_auto_upgrade` và `agent_role_provider` (giữ cả hai trong `features`, `config/mod.rs`, `core-plugins/manager.rs`, `config.schema.json`); `app-server/src/config_manager.rs` (**gỡ bản vá `thread_keeps_provider`**: upstream `e115d5f90d` đã làm mặc định, cờ thành cờ rỗng, thêm test canh `thread_on_other_configured_provider_stays_writable`); `tui/src/app/session_lifecycle.rs` (picker `/subagents`: thread chờ duyệt lên đầu theo upstream, trong mỗi nhóm giữ thứ tự main/running/done/closed và cột trạng thái của hcodex; snapshot `path_backed_agent_picker` sinh lại). Sau rebase chỉ 2 lỗi compile: `start_fresh_session` nhận `FreshSessionStart` thay cho `Option<ThreadStartSource>` → `tui/src/app/provider_setup.rs` dùng `FreshSessionStart::PreserveCurrentView(None)`. Upstream nâng Rust 1.95→**1.99.1** (`caf0d30005`), V8 giữ 152.2.0; `~/.cargo/registry` đã bị dọn nên tải lại toàn bộ + 3,4 GB submodule `rusty_v8`. **Kẹt 14 tiếng**: `cargo metadata` do rust-analyzer của app Claude bật đang tải submodule thì máy ngủ, kết nối chết nhưng tiến trình giữ khoá package cache → `cargo check` đứng chờ cả đêm; kill tiến trình treo là chạy tiếp, các lệnh build sau bọc `caffeinate -i`. Gate 363 test xanh (lần đầu, không retry), release 35m30s, smoke PASS (`model/list` 26 model, giống hệt binary 0.1.1 cũ khi probe bằng config thật). Binary build tại máy báo `codex-cli 0.0.0` (source build, check update tự bỏ qua). Test upstream đỏ sẵn, không do sync: `catalog_reload_uses_latest_model_provider` (mong mặc định `openai`), snapshot TUI có chữ "OpenAI Codex" như `watch_only_subagent`. Đáng chú ý cho harness: upstream có hẳn màn duyệt/sửa/tạo provider và chọn provider mặc định cho chat mới trong TUI + RPC app-server (`f1b9421648`, `74bfe33ec8`, `b2a8e68c74`, `9825e4b2fe`) → trùng một phần `/provider` của hcodex, chưa gộp; `e115d5f90d` thread giữ provider đã lưu; `18352dc4e8`/`cc3757a99d`/`bedafe7156` subagent và transcript trong sidebar TUI; `5a4aff8431` nâng trần model của `spawn_agent` lên 16 |
| 31/10/2026 (tay; job đêm 30 và 31/10 đều conflict) | `275a9a89b6` | 158 | Thư mục `target` bị xoá nên `hcodex` "command not found" → khôi phục từ `~/.hcodex/backup` rồi build lại từ đầu. 3 conflict: `core/guardian/reviewer_config.rs` + `models-manager/manager.rs` (upstream `dc40446064` đổi sang `CatalogModel`/`ModelOrigin`, bỏ cờ `used_fallback_model_metadata`; port lại override metadata theo model vào `construct_model_info` và trước `build_available_models`, `apply_to_model(s)` thành `pub`), `model-provider-info/lib.rs` (both-add, thêm `}`). Sau rebase còn 3 lỗi compile nhỏ: `ModelMessages` thêm field `apps` → `empty_model_messages` dùng `Default`; bỏ gán `used_fallback_model_metadata` trong `local_proxy_models.rs`; test upstream `provider_setup_wizards_require_eligible_onboarding` giả định provider mặc định là openai → fixture test ghim `model_provider=openai` khi không khai. Gate xanh (core 9+34, models-manager 47, provider 132, provider-info 41, features 62, tui 24), build 47 phút, smoke PASS. Upstream đáng chú ý: `bf877af418`/`7689f21b79` command center chạy embedded (`hcodex --no-daemon agents` mở được nhưng chỉ thấy thread của chính process nên không thay được `hc-agents.sh`), Guardian elastic budgeting, plugin app settings, hook PreToolUse trước Guardian |
| 28/10/2026 (tay, sau khi job đêm 02:07 conflict) | `c0e88f3c04` | 65 | 2 conflict, giữ cả hai: `codex-api/src/api_bridge.rs` (upstream `6a6e2fb1f0` thêm nhánh `policy_capacity_unavailable` cạnh nhánh `server_is_overloaded` mà hcodex gắn `.with_http_response_origin()`), `model-provider/src/provider.rs` (upstream `9cce575134` bọc `OpenAiModelsEndpoint` bằng `.with_runtime_auth(catalog_runtime_auth)`; giữ nhánh `LocalProxyModelsEndpoint` của hcodex cho provider OpenAI-compatible, nhánh OpenAI nhận runtime auth). Gate: 3 test credential upstream (`gcp::credential_files_scope_token…`, `amazon_bedrock::credential_export…`) fail cả 2 lần vì spawn `sh` quá 5 s khi máy swap → gate bỏ qua chúng (`--skip credential_export --skip credential_files_scope_token`), còn lại 344 test xanh. Build release 58 phút, smoke PASS. Đáng chú ý: `9cce575134` runtime auth dùng chung cho provider + catalog; `f00c70f5d0` cho override catalog URL của provider OpenAI; `4c54667b40` status line có profile/provider; `824b7666fb`/`90de7b92b6` Guardian review các tool multi-agent đổi state; `2edc8dcb0c` cờ bỏ description khỏi skill catalog (tiết kiệm context); `2d1984b9f7` V8 runtime cho UI plugin |
| 27/10/2026 (tay, sau khi job đêm 02:08 conflict) | `6fe77fc123` | 204 | job unattended 27/10 abort vì conflict `model-provider/src/{lib,provider}.rs`; chạy tay `--no-build`: 46 commit harness rebase, 2 lần dừng đều "giữ cả hai" (upstream thêm module `gcp` + `create_gcp_provider` cạnh `local_proxy_models` + `supports_responses_extensions`). Không phải sửa port nào: literal `ModelProviderInfo` của hcodex đều dùng `..Default::default()` nên 3 field mới (`project_id`, `location`, `credential_file`) không vỡ. Upstream **pin lại Rust 1.95.0** (`2cab11ca40`, từ 1.99.1) → test tui phải build lại từ đầu (~70 phút), release 43 phút. Gate lần 1 fail 3 test `codex-model-provider` nhưng chạy riêng 4 lần đều 129/129 (flaky khi máy swap) → gate giờ ghi log đầy đủ `~/.hcodex/log/sync-gate-<ts>.log` và retry 1 lần; lần 2 xanh hết (core 9+34, models-manager 46, provider 129, provider-info 38, features 60, tui 23). Đáng chú ý: `126a0ee92e` thêm gpt-6.1-terra vào catalog; `60adfa8513` lỗi model-not-found thành terminal (không retry); `716b4ec6df` refactor `agent/control/spawn.rs` (không đụng `role.rs`/`child_config.rs` của patch per-role provider); `cf29971d93` runtime auth vào model request; provider Vertex AI/GCP mới; plugin process host + cờ tắt prefetch plugin; hooks nhận cwd thật. Smoke PASS, flags `agent_role_provider`/`plugin_marketplace_auto_upgrade` còn nguyên |
| 23/10/2026 (job 22:03, tự động từ phiên Claude) | `9a8a85bc53` | 370 | rebase 33 commit harness, dừng 2 lần, đều "giữ cả hai" (`slash_command.rs`, `slash_dispatch.rs`, `chatwidget.rs`, `constructor.rs`: upstream thêm `Presets`/`quick_dials`/`permission_popup_pending` cạnh `Provider`/`provider_setup`/`other_provider_models`); 2 fix port: `to_auth_headers()` upstream trả `Result` → propagate ở endpoint catalog; dấu `}` nhánh `Presets` bị mất khi merge. Upstream nâng Rust 1.95→**1.99.1** và V8 150.4→**152.2.0** (tải trước, script tự chọn theo Cargo.lock). Build lại từ đầu ~4h (thường 45m). Đáng chú ý cho harness: `067249a283` giữ catalog cũ khi refresh lỗi, `ffd3429d75` giữ cache catalog khi đổi header credential, `7c073196a1`/`ab6095dde0` sửa cách build request, `430a16799d` giữ model settings khi resume/revert. Kiểm: smoke PASS, hibox 36 model qua credential file, spawn `pong`, codex-ide types regen |
| 13/10/2026 | `f82e365922` | 85 | rebase do agent hcodex (model `gpt-6-sol` qua cliproxy, chạy trong terminal khác) tự làm; upstream thêm field `encrypted_content`/`status` vào `Message` và `annotations`/`logprobs` vào `OutputText` → `render_agent_messages_as_plain_text` + test được cập nhật theo; smoke + spawn test pass; merge dở `origin/my-harness` bị abort, thay bằng cherry-pick commit docs |

**Khi upstream nhảy xa** (hàng trăm → nghìn commit) rebase từng commit harness sẽ
conflict lặp ở cùng file. Cách đã dùng ngày 07/10/2026 (1.530 commit): gộp toàn bộ
harness thành 1 commit rồi merge lên upstream, resolve 1 lần ở trạng thái cuối:

```bash
git tag harness-pre-sync-<date> my-harness          # giữ lịch sử cũ
git checkout -B harness-sync upstream/main
git merge --squash my-harness                        # resolve conflict 1 lần
git commit -m "hcodex harness: squash onto upstream <sha>"
# check/test như gate, rồi:
git branch -f my-harness harness-sync && git checkout my-harness
git push --force-with-lease origin my-harness
```

Từ đó `my-harness` = upstream + vài commit harness; các lần sync sau lại rebase
bình thường. Lịch sử chi tiết trước đó nằm ở tag `harness-pre-sync-*`.

**Test TUI bản debug không link được từ upstream `583ec348cf` (20/11/2026)**: `cargo test -p codex-tui`
dừng ở bước link với `ld: B/BL out of range … (max +/-128MB)` từ `ctor::priority_ctor::__ctor_private_inner`
tới `ctor::collect::run_constructors` (crate `ctor` 1.0.6, kéo vào qua `allocative`). Bản test debug của
TUI đã lớn tới mức hai hàm này cách nhau hơn 128MB, quá tầm nhảy của ARM64. Ở `4389a526d5` (19/11) còn
link được và `Cargo.lock` phần `ctor` không đổi, nên nhiều khả năng do upstream phình thêm; **chưa kiểm
chứng** trên upstream nguyên bản. `--config 'profile.dev.package.codex-tui.opt-level=1'` không cứu được.
Bản release (thin LTO) link bình thường. Hệ quả: gate nhóm `-p codex-tui -- provider_setup command_popup`
fail ở cả hai lần thử; tạm thời sync bằng `SKIP_TESTS=1 scripts/sync-upstream.sh --build-only` sau khi tự
chạy ba nhóm gate đầu, và test TUI của harness chưa chạy được cho tới khi tìm ra cách link.

Test upstream **tự fail trên macOS** (không liên quan harness, đã kiểm chứng trên
upstream nguyên bản): `retry_after::connection_failures_increment_retry_telemetry_without_consuming_retry_budget`
— gate của script không chạy test này.

Nếu rebase báo conflict: sửa file bị conflict (thường chỉ trong các file ở bảng
"Khác gì so với codex gốc" — kiểu "cả hai bên cùng thêm dòng" thì giữ cả hai),
rồi `git add <file> && git rebase --continue`, sau đó `scripts/sync-upstream.sh --build-only`.
Sau khi rebase, đẩy branch lên fork:

```bash
git push --force-with-lease origin my-harness
```

Chạy smoke test lẻ bất cứ lúc nào: `scripts/harness-smoke.sh` (mặc định test
`hcodex` trên PATH). Thêm provider/model nào đang dùng hằng ngày vào
`~/.hcodex/smoke-turns.txt` (mỗi dòng `provider model`) để nó được thử thật sau mỗi
lần build. Quy ước: mỗi sự cố provider đã mất công dò thì thêm một kiểm tra vào
script này, để lần sau máy bắt chứ không phải người.

Muốn gửi thay đổi ngược lên upstream thì tách commit đó ra branch riêng từ `main`
và mở PR — không PR từ `my-harness`.

## Xem main và subagent trong pane riêng: `scripts/hc-agents.sh` (29/10/2026)

Vấn đề: muốn thấy agent nào đang chạy gì mà không phải `/subagents` rồi nhảy vào thread,
và lỡ bấm `esc` trong thread con là ngắt nó. Giải pháp: một viewer **chỉ đọc**, chạy ở
terminal/pane khác, tail rollout mà core đã ghi sẵn. **Không đụng core, không hook, không
cần build**; sync đêm không biết nó tồn tại.

```bash
cd ~/github/digital-monorepo && ~/github/codex/scripts/hc-agents.sh   # session mới nhất có cwd bắt đầu bằng $PWD
scripts/hc-agents.sh --latest                                          # session mới nhất bất kỳ
scripts/hc-agents.sh --session <id>                                    # đúng một session
```

Mở nó trong split của iTerm/tmux cạnh hcodex. Hiển thị: `main` (model, lượt, tool, câu lệnh
cuối, đang chờ gì) và cây subagent theo `parent_thread_id`: role, nickname, path, `round N`
(số lần followup), model @ provider, trạng thái ● running / ✓ completed / ✗ error /
interrupted, tool đang chạy, dòng trả lời cuối, thời gian, số tool. Phím: `↑↓` cuộn,
`tab`/`n` chọn, `space` gập/mở, `d` chi tiết, `t` Tasks/DAG, `f` follow, `q` đóng. `q` chỉ
đóng viewer, không ngắt ai.

Cấu tạo (`scripts/hc-agents/`):
- `tail.mjs` (hcodex): quét `~/.hcodex/sessions` 3 ngày gần nhất, chọn thread chính
  (`thread_source != subagent`), gom con theo `parent_thread_id`, tóm tắt mỗi rollout
  (`task_started/task_complete/turn_aborted/error`, `function_call`/`output`, message) và
  lấy brief + số round từ lệnh `spawn_agent`/`followup_task` của thread cha (brief trong
  rollout con là `encrypted_content`, không đọc được). Ghi `~/.hcodex/agents-view/<key>.json`
  mỗi 0,7 s khi có thay đổi.
- `vendor/` = viewer của [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag)
  (Apache-2.0, giữ LICENSE + NOTICE), chỉ phần TUI độc lập; phần gắn OmO/Herdr không dùng.
  Node 22 chạy được dù README họ ghi 24.

Giới hạn: chỉ xem, độ trễ ≈ tốc độ core ghi rollout (<1 s); chế độ DAG (`t`) chỉ có khi có
`runs` với cạnh phụ thuộc, `$daily-dev`/`$orch` hiện chưa phát ra, nên mặc định là Tasks.
Một session mở 2 ngày thì "elapsed" của main tính từ lượt hiện tại, của con tính từ lúc spawn.

## Khối sub-agents sống ngay dưới dòng `Working` (01/11/2026)

Không cần gõ gì: khi session chính có agent con đang chạy, dưới dòng `• Working (…)` hiện:

```text
• Working (4m 56s · esc to interrupt)
  sub-agents · ⌥→ open · /subagents details
  ● dev_1      gemini-3.8-flash-high  2m 10s  $ go test ./internal/... -count=1
    Đang thêm case key rỗng vào strict_list.go, chạy lại test
  ● review_1   gpt-6.1-terra          0m 40s  $ git diff HEAD -- account-service/
    Preview cho thấy 3 file reviewable…
  ✓ dev_2      CHANGE REPORT đã gửi
```

Mỗi agent đang chạy: tên (`agent_path` bỏ `/root/`), model, thời gian từ lúc thấy chạy, lệnh
đang chạy (ItemStarted CommandExecution chưa có ItemCompleted), và dòng hoạt động cuối (cùng
bộ tóm tắt `/subagents` của upstream dùng). Agent xong gom thành một dòng `✓`, tối đa 3; không
còn con nào chạy thì khối biến mất. `⌥→`/`⌥←` nhảy vào/ra thread con (phím upstream),
`/subagents` in khối chi tiết + picker.

Cách làm, không đụng core: TUI vốn buffer event của mọi thread con (`app/thread_events.rs`).
`app/agents_live.rs` (hcodex) đọc buffer đó + `agent_navigation` dựng các dòng;
`thread_routing.rs` gọi nó sau mỗi Item/Turn/ThreadClosed của thread con; `chatwidget/
agents_live.rs` chuyển xuống `bottom_pane` (`set_agents_live_block`), `status_indicator_widget`
vẽ sau phần details, cắt theo bề rộng. Thời điểm bắt đầu giữ trong `static` của file hcodex để
không thêm field vào `App` upstream. Khác với `hc-agents.sh` (pane riêng, đọc rollout, thấy cả
lịch sử), khối này chỉ là cái nhìn nhanh trong session.

## `/subagents` có trạng thái, sắp xếp và lọc (05/11/2026)

Picker upstream chỉ có chấm xanh/xám (thread còn mở/đã đóng) và cột uuid. hcodex
(`tui/src/app/session_lifecycle.rs::agent_picker_selection_view_params`, dữ liệu từ
`app/agents_live.rs`) đổi thành:

```
  1. ● Main [default] (current)   working · claude-opus-5.5
  2. ● /root/dev_4                running · gemini-3.8-flash-high · 3m 12s · $ go test ./...
  3. ✓ /root/review_3             done 18m ago · VERDICT PASS …
  4. ✗ /root/review_1             closed
```

- Thứ tự: main, rồi đang chạy, rồi xong/idle, đóng xuống cuối. `⌥→`/`⌥←` vẫn đi theo thứ tự
  spawn như cũ.
- Cột phải: `running` + model + thời gian chạy + lệnh đang chạy (hoặc câu cuối); `done N ago` +
  câu cuối; `idle` khi chưa thấy chạy lần nào trong tiến trình này (vd session vừa resume);
  `closed`.
- Lọc: gõ `running` / `done` / `idle` / `closed` ngay trong picker (search có sẵn của
  SelectionView, từ khoá nằm trong `search_value` cùng tên và uuid).
- Thời gian chỉ tính từ lúc tiến trình TUI này thấy agent chạy; resume phiên cũ thì agent cũ
  hiện `idle`/`done` không có "N ago".

## Tìm lại session (`/resume` không thấy phiên cũ)

Ba lý do thường gặp và cách xử lý:

1. **`/resume` chỉ liệt kê phiên mở từ đúng thư mục hiện tại.** Phiên mở ở
   `digital-monorepo/esign-service` không hiện khi mày đứng ở root monorepo và ngược
   lại. Trong picker bấm **Ctrl+A** để xem mọi thư mục (có thêm cột CWD), hoặc chạy
   `hcodex resume --all`.
2. **Ô tìm kiếm của picker chỉ khớp tên thread và câu đầu tiên mày gõ**, không tìm trong
   nội dung. Mỗi trang 25 phiên, cuộn xuống để tải thêm; Ctrl+E xem trước transcript.
3. Phiên chạy bằng `hcodex exec` bị ẩn; thêm `--include-non-interactive` nếu cần.

Tìm theo **nội dung** (từ khoá bất kỳ trong hội thoại, kể cả câu trả lời của model):

```bash
scripts/hc-find-session.sh "ccq" 30          # từ khoá, số ngày (mặc định 30)
# 2026-10-21T04:26  github/digital-monorepo/esign-service  01a15cb5-...  check cho tao chổ gen hop đồng ccq
hcodex resume 01a15cb5-da89-7b31-823c-98a86cb5726a
```

In ra ngày, thư mục, thread id, câu hỏi đầu tiên, mới nhất trước. Đặt tên thread
(`/rename`-tương đương: `hcodex resume` nhận cả tên) giúp tìm bằng picker về sau.

## Sự cố thường gặp

**Gemini qua proxy trả 429 "Resource has been exhausted" dù chat thẳng model thì được**
(20/11/2026, Fusebox `127.0.0.1:8317`, `gemini-3.8-flash-high`, provider upstream `antigravity`):
không phải quota và không phải kích thước. Bắt nguyên request của hcodex bằng một server ghi
lại rồi gửi lại vào proxy, cắt dần: bỏ tool vẫn 429, bỏ danh sách skill vẫn 429, chỉ khi đổi
**đoạn mở đầu của prompt hệ thống** thì cùng request 84 KB đó trả 200 (3 lần đổi đều 200, 3 lần
giữ đều 429). Đoạn đó là mở đầu của prompt mặc định `models-manager/prompt.md`: "You are a
coding agent running in the Codex CLI ... led by OpenAI". Backend của Google từ chối request
Gemini mang câu này và trả 429 thay vì lỗi nội dung.

hcodex vốn thay đoạn mở đầu mang danh tính OpenAI bằng câu trung lập
(`normalize_proxy_model_instructions` trong `model-provider/src/local_proxy_models.rs`), nhưng
chỉ nhận ra "You are Codex", "You are GPT", "based on GPT". Prompt mặc định không khớp cả ba
nên lọt. Đã thêm "Codex CLI" và "OpenAI" vào điều kiện, có test
`proxy_models_replace_the_fallback_prompt_opening` dùng đúng prompt mặc định.

Để lần sau không mất nửa ngày, `scripts/harness-smoke.sh` (chạy sau mỗi lần build, trước khi
cài) có thêm hai kiểm tra:

- **Danh tính trong request (không cần mạng)**: dựng một server ghi lại đóng vai provider,
  chạy `hcodex exec` qua nó cho 3 họ model (`gemini-*`, `claude-*`, `gpt-*`), rồi kiểm đoạn mở
  đầu prompt hệ thống không chứa `Codex`, `OpenAI`, `GPT`. Hỏng là FAIL. Bắt được ca upstream đổi
  câu chữ prompt mặc định.
- **Lượt thật theo từng provider/model**: mỗi dòng `provider model` trong
  `~/.hcodex/smoke-turns.txt` (hiện có `hibox gemini-3.8-flash-high`, `hibox claude-haiku-5-5`;
  hoặc `HCODEX_SMOKE_TURNS="hibox:gemini-3.8-flash-high,..."`). Trước tiên **hỏi thẳng provider**
  một request nhỏ: không trả 200 thì WARN và bỏ qua (provider chết hoặc hết quota, không phải lỗi
  harness). Trả 200 mà lượt qua hcodex không ra `pong` trong 90 giây thì FAIL. Lượt qua proxy mặc
  định cũng theo đúng luật này, nên proxy chết không còn chặn việc cài bản mới.

Chạy trên bản **chưa sửa**, smoke mới báo đúng cả hai: 3 dòng "system prompt … opens with an
OpenAI identity" và "hibox/gemini-3.8-flash-high answers directly, but the turn through hcodex
did not answer".

Lỗi này trông giống rate limit thật vì hcodex retry 429 rồi treo vài phút ("Reconnecting…
n/5"), và mỗi lần 429 làm Fusebox khoá tài khoản khoảng 10 giây ("all accounts for … are rate
limited"), nên gọi thẳng ngay sau đó cũng 429. Cách kiểm nhanh khi gặp lại: xem
`~/Library/Logs/fusebox.log`, nếu `client_app="Codex"` toàn 429 còn client khác 200 trong cùng
phút thì là do nội dung request, không phải quota.

**MCP Jira không có tool / agent tự `curl` Atlassian bằng token trong config** (phát hiện
16/10/2026): config cũ khai `npx -y @sooperset/mcp-atlassian`, package này **không tồn tại
trên npm** (404) nên server MCP chưa từng chạy, mỗi lần mở hcodex mất vài giây chờ npx
thất bại, model không thấy tool `jira` rồi đọc token trong `config.toml` để `curl` thẳng
REST API (token lọt vào rollout `~/.hcodex/sessions/*.jsonl`; trong sandbox mặc định
không có mạng nên "không kết nối được"). Đã đổi sang bản thật (Python):

```toml
[mcp_servers.jira]
command = "/Users/hiepln/.local/bin/uvx"
args = ["mcp-atlassian", "--env-file", "/Users/hiepln/.hcodex/jira.env"]   # JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN
startup_timeout_sec = 60
```

`~/.hcodex/jira.env` quyền 0600, token không còn trong `config.toml`. Nên đổi token Jira
sau khi sửa vì token cũ đã nằm trong rollout.

**`Error: this CLI has no complete local package; install a packaged Codex CLI…`**
khi mở `hcodex` (từ sync 13/10/2026): upstream mặc định chạy TUI qua một
app-server daemon nền và tự cài "package" của CLI; bản build từ source không có
package đó. hcodex tắt sẵn trong `~/.hcodex/config.toml`:

```toml
[features]
daemon_auto_start = false      # chạy app-server nhúng, tương đương --no-daemon
```

Hệ quả: `hcodex agents` (command center dùng chung daemon) không dùng được;
`/agents` và `/subagents` trong TUI vẫn chạy bình thường.


- `Model provider ... not found` / lỗi kết nối → proxy chưa chạy ở `:8181`,
  hoặc set `HCODEX_PROXY_URL` đúng.
- `Code Mode is unavailable ... codex-code-mode-host: host executable was not found`
  → chưa symlink `codex-code-mode-host` cạnh `hcodex` (xem Build & cài).
- `Selected model is at capacity. Please try a different model.` → proxy/gateway
  báo `server_is_overloaded` giữa stream. hcodex tự retry với status
  "Model at capacity, retrying... n/m" (chờ 2s, 4s, 8s, 16s, 30s…); chỉ khi hết
  lượt mới báo lỗi. Mặc định 5 lượt (~60s); proxy hay nghẽn lâu thì tăng trong
  `config.toml`:
  ```toml
  [model_providers.cliproxy]
  stream_max_retries = 10        # ~3.5 phút chờ tổng cộng
  ```
  (Provider `openai` giữ hành vi upstream: không retry, để mày đổi model.)
- `exceeded retry limit, last status: 429 Too Many Requests` ngay sau 1 request →
  provider trả 429 (rate limit). codex gốc không retry 429 (với OpenAI 429 = hết
  quota). hcodex: provider **không phải OpenAI** được retry ở lớp HTTP, tôn trọng
  `Retry-After` (tối đa 60s), không có header thì chờ 2s/4s/8s/16s/30s; số lượt =
  `request_max_retries` (mặc định 4). Tăng nếu proxy hay giới hạn:
  ```toml
  [model_providers.cliproxy]
  request_max_retries = 8
  ```
- Proxy trả `usage_limit_reached` để probe quota hoặc `rate_limit_exceeded` trong
  SSE → hcodex không ghi nó thành quota OpenAI. Harness retry lại toàn request
  theo `stream_max_retries`, hiện status `Provider rate limit, retrying...` và
  chỉ báo lỗi khi hết lượt.
- Sub-agent "đứng" hàng giờ, block sub-agents vẫn hiện lệnh cuối, main cứ
  `Waiting for agents` (gặp 03/11/2026 với `reviewer` trên cliproxy): proxy trả 503
  kèm `Retry-After: 12353` (3h26m) và core **ngủ đúng chừng đó** trước khi thử lại,
  không báo lỗi vì vẫn là "retry 1/5". Nhận dạng: rollout của con không có dòng mới
  sau một `function_call_output`, và `logs_2.sqlite` có `Request completed ... status=503`
  với `retry-after` lớn ngay trước đó. Từ bản sửa 03/11/2026
  (`core/src/responses_retry.rs::cap_provider_retry_after`), provider **không phải
  OpenAI** chỉ được chờ tối đa **60s** mỗi lượt dù header đòi bao nhiêu (log WARN
  `provider Retry-After exceeds the hcodex ceiling`); hết `stream_max_retries` (5 lượt,
  ~5 phút) thì turn con fail và `wait_agent` của main nhận lỗi để đổi provider. Chữa
  tại chỗ khi gặp: sửa `model_provider` của role sang provider khác (role file được
  đọc lại ở mỗi lần spawn, không cần restart), `esc` cắt lượt wait của main rồi bảo
  nó `close_agent` con treo và spawn lại.
- `/model` hiện danh sách cũ → danh sách được cache 5 phút ở
  `~/.hcodex/models_cache-<provider-hash>.json` (OpenAI chính chủ vẫn dùng
  `models_cache.json`). Mỗi provider như `cliproxy`, `kr` có cache riêng; xoá
  file hash tương ứng hoặc toàn bộ `models_cache-*.json` để buộc tải lại.
- `hook: SessionStart Failed` / `UserPromptSubmit Failed` trong `hcodex exec`, câu trả lời
  không còn `<openviking-context>` → plugin cache vừa re-sync, fingerprint thư mục plugin
  đổi nên hook bị từ chối ("plugin contents changed; hook approval required"). Chạy
  `scripts/hc-approve-hooks.sh ~/github/<repo>` (hoặc `/hooks` trong TUI), rồi mở
  session mới. Không liên quan tới OpenViking server hay API key (26/10/2026 từng nhầm).
  Gốc rễ (xác minh 26/10/2026): upstream OpenViking sửa `examples/codex-memory-plugin`
  liên tục (5 commit trong 22–26/10, hai lần riêng ngày 26/10) nhưng **không đổi version
  0.11.15**; marketplace `docs.openviking.ai/dl/plugins/memory-plugins.git` là repo sinh
  tự động (1 commit, ngày 2000-01-01) nên revision đổi theo; còn hcodex/app-server mỗi
  lần khởi động chạy thread `plugins-marketplace-auto-upgrade` re-clone marketplace và
  cài đè cache (`~/.hcodex/plugins/cache/openviking/openviking-memory/0.11.15`). Hệ quả:
  mỗi commit upstream ⇒ lần mở hcodex kế tiếp hook chết im cho tới khi approve lại.
  Chữa tận gốc: `[features] plugin_marketplace_auto_upgrade = false` + cập nhật thủ công
  bằng `scripts/hc-update-plugins.sh` (mục "Đóng băng plugin cache").
- `/model` sau khi đổi provider giữa hội thoại hiện danh sách của provider cũ gắn tên provider
  mới (ví dụ `local-proxy via cliproxy (antigravity)`), provider cũ biến mất khỏi danh sách,
  provider vừa chọn hiện hai lần (28/10/2026): catalog model được nạp một lần lúc khởi động cho
  provider ban đầu (`App.model_catalog`) và mọi widget sau fork dùng lại. Fix: sau khi fork
  thành công, `switch_provider_in_place` tải `{base_url}/models` của provider mới và thay catalog
  (`refresh_model_catalog_for_provider`, `ChatWidget::set_model_catalog`); tải lỗi thì giữ
  catalog cũ và báo "Could not load the model list of `<id>`". Log kiểm chứng trong
  `~/.hcodex/logs_2.sqlite`: `hcodex: model catalog reloaded for provider switch`.
- "This chat uses X, but Codex now uses Y, so this chat is read-only" (upstream `55c099a142`,
  từ sync 31/10/2026). Upstream so provider của thread với provider trong config trên đĩa
  (profile `-p`), lệch là khoá nhập liệu. Nó bắn cả khi `/model` đổi provider **trong phiên**:
  fork sang hibox thành công rồi bị khoá ngay vì profile vẫn là kr (gặp 04/11/2026). Từ
  04/11/2026 hcodex có flag `[features] thread_keeps_provider = true` (đã bật trong
  `config.toml`, mặc định tắt để giữ test upstream): thread chạy tiếp trên provider đã ghi
  miễn provider đó có trong `[model_providers]`; áp dụng cho cả nhập liệu
  (`check_thread_model_provider_for_input`) lẫn resume (`load_for_resume`,
  `app-server/src/config_manager.rs`). Provider lạ vẫn bị khoá như upstream. Khi chưa có
  bản build này: resume bằng đúng profile của thread (status line có `provider: <id>`),
  hoặc `c` chat mới có câu dẫn, `n` chat mới, `esc` chọn chat khác.
  Test: `cargo test -p codex-app-server --lib -- thread_keeps_provider input_provider_check`
  (2 test `catalog_reload_*` cùng crate fail sẵn vì hcodex mặc định `local-proxy`, upstream mong
  `openai`; gate sync không chạy nhóm này).
  **Từ sync 19/11/2026 không cần flag nữa**: upstream `e115d5f90d` ("Keep threads on their saved
  model provider when defaults change") bỏ hẳn bước so provider khi nhập liệu
  (`check_thread_model_provider` giờ chỉ xét managed requirements) và khi resume thì ép thread về
  provider đã lưu. Bản vá hcodex trong `config_manager.rs` đã gỡ; `thread_keeps_provider` thành cờ
  rỗng (để nguyên trong `config.toml` cũng được). Test canh hành vi:
  `cargo test -p codex-app-server --lib -- thread_on_other_configured_provider_stays_writable`.
- Đổi provider trong một session **chưa có lượt nào** báo `thread/fork failed: no rollout found`:
  upstream ghi rollout lười, chưa có file để fork. Bản cũ: gửi một câu trước rồi đổi, hoặc mở
  `hcodex -p <profile>` thẳng. Từ 03/11/2026 (`tui/src/app/provider_setup.rs`): gặp lỗi này
  hcodex tự mở thread mới trên provider vừa chọn (không có gì để mang theo) và báo
  "Now using `<model>` via `<provider>` (new chat …)".
- `zsh: command not found: hcodex` dù `~/.cargo/bin/hcodex` vẫn có (31/10/2026): symlink trỏ vào
  `codex-rs/target/release/hcodex` mà thư mục `target` đã bị xoá. Từ 01/11/2026 script cài
  **copy** binary vào `~/.hcodex/bin/` và symlink `~/.cargo/bin/hcodex` vào đó, nên xoá cả
  `target` cũng không sao. Nếu vẫn gặp: `scripts/sync-upstream.sh --rollback` (lấy từ
  `~/.hcodex/backup`).
- **Dọn ổ cứng**: được xoá `codex-rs/target/debug` (test gate, ~20 GB, script giờ tự xoá sau mỗi
  lần cài; `KEEP_DEBUG=1` để giữ khi đang chạy test nhiều trong ngày), toolchain rustup cũ
  (`rustup toolchain uninstall <ver>`, giữ bản `rust-toolchain.toml` đang pin), `~/.hcodex/.tmp/git-*`.
  **Giữ**: `~/.hcodex/bin` (binary đang chạy), `~/.hcodex/backup`, `~/.hcodex/sessions`
  (`/resume`), `~/.cargo/registry` + `~/.cargo/git` (dependency, xoá là tải lại),
  `~/.cargo/.rusty_v8` (V8 prebuilt), `target/release/deps` (giữ thì rebuild 40 phút thay vì 2 giờ).
- Bấm "Trust and continue" báo `config/batchWrite failed … Invalid configuration: invalid
  transport in mcp_servers.jira` (03/11/2026): file profile (`kr.config.toml`) có bảng lẻ
  `[mcp_servers.jira.tools.*]` trong khi `command` của jira ở `config.toml`; TUI ghi trust vào
  file profile rồi validate riêng file đó nên jira "không command, không url". Quy tắc: mọi
  bảng `[mcp_servers.<x>…]` để chung một file với khối `[mcp_servers.<x>]` có `command`/`url`
  (đã chuyển vào `config.toml`).
- `hcodex exec` treo → stdin không phải TTY, thêm `</dev/null`.
- Lỗi 401 tới `chatgpt.com/backend-api/plugins/featured` → do không login
  ChatGPT, vô hại.
- Không thấy lệnh trong tab terminal cũ → `hash -r` hoặc mở tab mới.

## Liên quan

- App desktop giờ nằm ngay trong repo này ở `hcodex-app/` (xem mục "App desktop: `hcodex-app/`").
  Repo cũ `~/github/codex-ide` còn nguyên trên máy Mac nhưng không dùng nữa.
