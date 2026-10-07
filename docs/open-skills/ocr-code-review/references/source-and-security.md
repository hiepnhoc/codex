# Alibaba Open Code Review source and security notes

## Pinned source

- Repository: https://github.com/alibaba/open-code-review
- Source revision reviewed: `bc32734cdfd74cf779bd46e5d010e4c299624e34`
- Source date: 2026-07-27
- CLI release tested: `v1.7.17`
- Release commit: `0ced7165718725e15223c3e5a506df7b7e9de51f`
- License: Apache-2.0

## Tested binary

For macOS arm64:

```text
Asset: opencodereview-darwin-arm64
SHA-256: d1771b962ae518bd0e75093b695633e1d12f80700521f5eb5872651b83595012
Reported version: open-code-review v1.7.17 (0ced7165) darwin/arm64
```

The release binary is Mach-O arm64 and checksum-matched the published `sha256sum.txt`. It is ad-hoc/linker signed, has no Developer ID team identity, and was rejected by `spctl`; checksum pinning is mandatory and notarization is not claimed.

The `v1.7.17` Git tag contains an SSH signature. Local cryptographic identity verification was not completed because an allowed-signers trust file was not configured. Presence of a signature is not the same as establishing signer trust.

## Why delegation mode is the default

Delegation mode uses OCR only to identify reviewable files, classify the workspace/commit/range target, and resolve review rules. OpenCode reads the diff and performs the reasoning. OCR does not need a separately configured LLM endpoint in this mode.

## Security findings that shaped the adapter

1. The upstream npm package has a `postinstall` script. It installs a platform binary or downloads a GitHub release binary, then verifies the published SHA-256 file.
2. The npm wrapper starts a detached update checker unless `OCR_NO_UPDATE` is set. The checker can run `npm i -g <package>@<new-version>` automatically.
3. The native OpenCode plugin spawns `ocr` with an argument array and `shell: false`, enforces a 15-minute timeout and 10 MiB combined output limit, but passes the full `process.env` into OCR.
4. Managed review can read source and send it to a configured LLM endpoint.
5. OCR session persistence writes owner-only JSONL under `~/.opencodereview/sessions/<encoded-repo>/`. Managed sessions can contain resolved messages, LLM responses, tool calls, comments, model identifiers, and token usage.
6. Delegation preview also creates session JSONL. The local adapter avoids retention by running each allowed OCR command with a temporary HOME and deleting it afterward.
7. Telemetry is disabled by default, but persistent config can enable it and optional content logging. The safe helper prevents loading persistent OCR config and removes inherited telemetry/provider variables.
8. The upstream OpenCode plugin and MCP server were not installed. The adapter does not require either.
9. Upstream documents Git `>=2.41`. The audited Mac had Apple Git `2.39.3`; workspace delegation preview/rule passed on a fixture, but full compatibility is not claimed.

## Local integration decisions

Adapted:

- deterministic preview and rule resolution;
- workspace, commit, and range modes;
- line-level, severity-ranked findings;
- business-context support;
- optional review-and-fix loop.

Not imported/enabled:

- upstream OCR-managed skill as the default;
- native OpenCode plugin;
- MCP integration;
- persistent OCR provider credentials;
- automatic update checker;
- persistent session viewer/history;
- automatic fixes for review-only requests.

## Update procedure

1. Fetch latest upstream source and release metadata without executing repository code.
2. Compare from source revision `bc32734cdfd74cf779bd46e5d010e4c299624e34` and CLI `v1.7.17`.
3. Inspect delegation commands, session persistence, telemetry, installer/update behavior, plugin authority, and new network/process paths.
4. Verify release checksum/signature evidence and test in an isolated HOME/repository.
5. Update pinned installer checksums only after the exact binary passes fixture tests.
6. Create a new dated pack snapshot, update registry/ledger, validate a fresh target, and require explicit active installation.
