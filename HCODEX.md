# hcodex — code-agent harness cá nhân (fork của openai/codex)

Branch `my-harness` trong repo này. Binary tên `hcodex`, tách hoàn toàn khỏi
`codex` của Codex CLI / ChatGPT Desktop app (dùng song song được).

## Khác gì so với codex gốc

| Thay đổi | File |
|---|---|
| Binary `hcodex` (thay vì `codex`) | `codex-rs/cli/Cargo.toml` |
| Home mặc định `~/.hcodex` (vẫn tôn trọng `CODEX_HOME`) | `codex-rs/utils/home-dir/src/lib.rs` |
| Provider built-in `local-proxy` và là provider **mặc định** | `codex-rs/model-provider-info/src/lib.rs` |
| Model mặc định `claude-sonnet-5` khi dùng `local-proxy` | `codex-rs/core/src/config/mod.rs` |
| Branding `OpenAI Codex` → `hcodex` | `codex-rs/tui/...`, `codex-rs/exec/...` |
| `/model` liệt kê model từ provider (`GET {base_url}/models`, mọi provider OpenAI-compatible) + effort low/medium/high/xhigh | `codex-rs/model-provider/src/local_proxy_models.rs`, `codex-rs/models-manager/src/manager.rs` |
| Catalog của proxy được chuẩn hoá thành prompt harness trung lập cho mọi model (GPT, Claude, Gemini, Qwen, GLM…), kể cả catalog file; cache model gắn identity provider+auth (cơ chế upstream) và không trộn catalog OpenAI bundled vào | `codex-rs/model-provider/src/local_proxy_models.rs`, `codex-rs/model-provider/src/provider.rs`, `codex-rs/models-manager/src/manager.rs` |
| `/provider` trong TUI: thêm provider (id, base URL, key) → kiểm tra `/models` → chọn model → ghi config + profile | `codex-rs/tui/src/bottom_pane/provider_setup_view.rs`, `codex-rs/tui/src/chatwidget/provider_setup.rs`, `codex-rs/tui/src/app/provider_setup.rs` |
| HTTP 429 từ provider **không phải OpenAI** được retry ở lớp HTTP, tôn trọng `Retry-After` (codex gốc không retry 429) | `codex-rs/model-provider-info/src/lib.rs` (`retry_429`), `codex-rs/codex-client/src/retry.rs` |
| `server_is_overloaded`, SSE rate-limit và HTTP `usage_limit_reached` từ proxy được retry cấp turn (2s→30s/lần, tối đa `stream_max_retries`) thay vì kết thúc turn giả; OpenAI chính chủ giữ semantics upstream | `codex-rs/core/src/session/turn.rs`, `codex-rs/core/src/responses_retry.rs` (+ test `core/tests/suite/hcodex_overload_retry.rs`) |

Diff code so với upstream nhỏ (≈15 file, phần lớn là file mới) → rebase lên upstream dễ.
Sau sync 07/10/2026 nhiều hook harness đã được thay bằng cơ chế upstream: cache catalog
theo identity provider+auth, `with_provider_catalog()` (không trộn catalog OpenAI),
`Retry-After` native ở lớp HTTP, `[model_providers.x.capabilities]` của upstream
(`external_web_access`, `remote_compaction`) — cấp provider, bổ sung chứ không trùng
`model_overrides.toml` (cấp model).

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
hcodex -p sonnet       # local-proxy, claude-sonnet-5, effort medium
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
