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
| `/provider` trong TUI: thêm provider (id, base URL, key) → kiểm tra `/models` → chọn model → ghi config + profile; `/model` gộp model của mọi provider, chọn là đổi provider **giữ nguyên hội thoại** (fork thread); `/provider use <id> [model]` là đường tắt | `codex-rs/tui/src/bottom_pane/provider_setup_view.rs`, `codex-rs/tui/src/chatwidget/provider_setup.rs`, `codex-rs/tui/src/app/provider_setup.rs` |
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
| `hibox` | key trong `~/.hcodex/provider-credentials/hibox.token` (0600, đọc qua `hcodex provider-credential hibox`) | proxy local `:8318`, 27 model (gpt-6-*, gemini-3.x, claude-*); `hcodex -p hibox` = gpt-6-sol; có trong `/model` gộp (thêm 20/10/2026) |
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

**Máy thiếu RAM khi build**: supervisor của session (và macOS) kill cargo ở bước
link test TUI hoặc link binary release. Cách đã dùng ngày 12/10/2026: chạy gate
với `BUILD_JOBS=2`, bỏ test TUI (`SKIP_TESTS=1`, release build vẫn compile crate
TUI nên lỗi biên dịch vẫn lòi ra), và chạy script **tách khỏi session**
(`nohup … &` rồi poll log) thay vì background task của session.

**Lịch sử sync**

| Ngày | upstream/main | Số commit | Ghi chú |
|---|---|---|---|
| 07/10/2026 | `18e28fe1b9` | 1.530 | squash-sync, 19 file conflict (xem dưới) |
| 12/10/2026 | `2351d9e1b6` | 111 | rebase thường, 1 conflict `core/src/session/turn_context.rs` (upstream bỏ backend zsh vá → bỏ khối `UnifiedExecShellMode`); diff harness trước/sau sync giống hệt nhau (interdiff 0 dòng); 2 test Bedrock `credential_export` flaky dưới tải, chạy riêng pass |
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
