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
| `/model` liệt kê model từ provider (`GET {base_url}/models`, mọi provider OpenAI-compatible) + effort low/medium/high/xhigh | `codex-rs/model-provider/src/local_proxy_models.rs`, `codex-rs/models-manager/src/manager.rs` |
| Catalog của proxy được chuẩn hoá thành prompt harness trung lập cho mọi model (GPT, Claude, Gemini, Qwen, GLM…), kể cả catalog file; cache model gắn identity provider+auth (cơ chế upstream) và không trộn catalog OpenAI bundled vào | `codex-rs/model-provider/src/local_proxy_models.rs`, `codex-rs/model-provider/src/provider.rs`, `codex-rs/models-manager/src/manager.rs` |
| `/provider` trong TUI: thêm provider (id, base URL, key) → kiểm tra `/models` → chọn model → ghi config + profile | `codex-rs/tui/src/bottom_pane/provider_setup_view.rs`, `codex-rs/tui/src/chatwidget/provider_setup.rs`, `codex-rs/tui/src/app/provider_setup.rs` |
| HTTP 429 từ provider **không phải OpenAI** được retry ở lớp HTTP, tôn trọng `Retry-After` (codex gốc không retry 429) | `codex-rs/model-provider-info/src/lib.rs` (`retry_429`), `codex-rs/codex-client/src/retry.rs` |
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
ln -sf ~/github/codex/codex-rs/target/release/hcodex ~/.cargo/bin/hcodex
# code-mode host phải nằm cạnh hcodex (codex tìm nó trong cùng thư mục)
ln -sf ~/github/codex/codex-rs/target/release/codex-code-mode-host ~/.cargo/bin/codex-code-mode-host

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

### Dùng chung skills / prompts với codex gốc

`hcodex` đọc `~/.hcodex/skills` (không phải `~/.codex/skills`). Để dùng chung bộ
skill với codex-cli, symlink:

```bash
ln -sfn ~/.codex/skills ~/.hcodex/skills
```

Tương tự cho `~/.hcodex/AGENTS.md`, `~/.hcodex/prompts` nếu muốn dùng chung.
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
| `openrouter` | `export OPENROUTER_API_KEY=sk-or-...` | Responses API native (đã verify); ~427 model; list model không cần key, chạy turn mới cần |
| `litellm` | chạy LiteLLM ở `:4000` (xem dưới) | gateway sang Anthropic/Gemini/Groq/DeepSeek… |
| `azure` | bỏ comment trong config, điền resource + `AZURE_OPENAI_API_KEY` | có `query_params.api-version` |
| `openai` | built-in; login hoặc `OPENAI_API_KEY` | |
| `ollama` / `lmstudio` | built-in; `localhost:11434` / `:1234` | |
| `amazon-bedrock` | built-in; cần AWS creds | |

**Thêm provider ngay trong TUI: `/provider`** (tính năng riêng của hcodex)

```
hcodex
> /provider                       # hỏi lần lượt: id → base URL → API key (Enter để bỏ qua)
> /provider groq https://api.groq.com/openai/v1           # không key: có thể nhập 1 dòng
```

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

## Memory + RAG cho repo lớn: OpenViking (07/10/2026)

Vấn đề: mỗi session mới lại phải quét các module trong `digital-monorepo` → tốn
token/thời gian. Giải pháp: [OpenViking](https://github.com/volcengine/OpenViking)
(context DB: memory + RAG + skills, AGPL-3.0) chạy local, gắn vào **hcodex qua
plugin hooks + MCP**; `~/.codex` không bị đụng.

Thành phần đã cài:

| Thành phần | Ở đâu | Chạy bằng |
|---|---|---|
| OpenViking server v0.4.23 | `uv tool install openviking`; config `~/.openviking/ov.conf`; data `~/.openviking/data` | launchd `ai.openviking.server` (port 1933, auth `dev`) |
| Embedding | Ollama `nomic-embed-text` (768d), binary `~/.local/bin/ollama` + `~/.local/lib/ollama` (tarball GitHub, brew fail) | launchd `com.ollama.serve` (127.0.0.1:11434) |
| VLM (tóm tắt L0/L1) + query planner | `claude-haiku-4.5` qua proxy `http://127.0.0.1:8181/v1` | — |
| Plugin cho hcodex | `openviking-memory@openviking` (marketplace trong `~/.hcodex/config.toml`) | hooks: SessionStart / UserPromptSubmit / Stop / PreCompact / SessionEnd |
| CLI | `ov` (`~/.openviking/ovcli.conf` → `http://127.0.0.1:1933`) | |

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
  Xem/đổi trong TUI bằng `/hooks`. Khi plugin cập nhật, hash đổi → TUI hỏi trust lại.
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

## Cập nhật từ upstream (openai/codex)

Mô hình branch:

- `upstream` → `https://github.com/openai/codex` (nguồn), `origin` → fork của mày.
- `main` chỉ theo `upstream/main`, **không commit** vào đây.
- `my-harness` = `main` + các commit harness, luôn được **rebase** lên `main`
  (diff nhỏ, ít conflict). Mọi phát triển riêng đều commit vào `my-harness`.

Đồng bộ + rebuild bằng 1 lệnh:

```bash
scripts/sync-upstream.sh --dry-run   # xem main tụt bao nhiêu commit, upstream đụng file harness nào
scripts/sync-upstream.sh             # fetch, ff main, rebase, build release, test gate, smoke, cài
scripts/sync-upstream.sh --no-build  # chỉ đồng bộ git
scripts/sync-upstream.sh --build-only  # sau khi tự sửa conflict: build + gate + cài
scripts/sync-upstream.sh --rollback  # cài lại binary đã backup ở ~/.hcodex/backup (build mới bị lỗi)
SKIP_TESTS=1 scripts/sync-upstream.sh  # bỏ qua cargo test (vẫn chạy smoke)
```

Script bảo vệ mày thế nào:

- Trước khi rebase: tag `harness-pre-sync-<UTC>` trên `my-harness`. Sync hỏng thì
  `git rebase --abort && git reset --hard <tag>` là về y cũ.
- `rerere` bật: conflict đã resolve một lần sẽ tự resolve lại lần sau.
- Trước khi cài: backup binary đang dùng vào `~/.hcodex/backup/`, chạy unit test
  harness (`codex-model-provider`, `provider_setup`, `command_popup`), build release,
  rồi `scripts/harness-smoke.sh` trên binary **mới build** (version, `/model` phải
  lấy list từ proxy, 1 turn `exec` qua proxy). Fail ở bước nào thì binary cũ vẫn
  nguyên, không symlink đè.
- Cảnh báo nếu `Cargo.lock` nâng `v8` khác với artifact V8 đang cache.
- File untracked (như `docs/open-skills/scripts/`) không chặn sync; chỉ file đã
  sửa chưa commit mới chặn.

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
`hcodex` trên PATH).

Muốn gửi thay đổi ngược lên upstream thì tách commit đó ra branch riêng từ `main`
và mở PR — không PR từ `my-harness`.

## Sự cố thường gặp

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
- `/model` hiện danh sách cũ → danh sách được cache 5 phút ở
  `~/.hcodex/models_cache-<provider-hash>.json` (OpenAI chính chủ vẫn dùng
  `models_cache.json`). Mỗi provider như `cliproxy`, `kr` có cache riêng; xoá
  file hash tương ứng hoặc toàn bộ `models_cache-*.json` để buộc tải lại.
- `hcodex exec` treo → stdin không phải TTY, thêm `</dev/null`.
- Lỗi 401 tới `chatgpt.com/backend-api/plugins/featured` → do không login
  ChatGPT, vô hại.
- Không thấy lệnh trong tab terminal cũ → `hash -r` hoặc mở tab mới.

## Liên quan

- `~/github/codex-ide` — IDE desktop (Tauri + React) chạy trên
  `hcodex app-server`. Đã trỏ sang harness (commit `af4e65c` bên đó):
  bin mặc định `~/.cargo/bin/hcodex`, home `~/.hcodex`, protocol types
  regenerate từ hcodex. Chạy: `cd ~/github/codex-ide && pnpm tauri dev`.
  Sau mỗi lần `scripts/sync-upstream.sh`, chạy lại bên IDE:
  `hcodex app-server generate-ts --out src/protocol && pnpm exec tsc --noEmit`.
