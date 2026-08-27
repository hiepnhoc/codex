# Changelog

## 0.2.0 — Codex conversion

- Changed the host runtime from OpenCode to Codex.
- Added Codex global and repository-local discovery paths.
- Replaced OpenCode-only worker/tool assumptions with capability-based wording.
- Mapped manual-only invocation to `agents/openai.yaml` policy.
- Added rollback-safe validation, installation, and rollback scripts.
- Preserved OpenCode terminology where OpenCode is the product under test.

## 0.1.3 - OpenCode OCR review adapter

Added a security-adapted `ocr-code-review` skill based on Alibaba Open Code Review at source revision `bc32734cdfd74cf779bd46e5d010e4c299624e34`, with pinned CLI release `v1.7.17`.

### Added

- OCR delegation workflow for workspace, commit, and branch-range review.
- Pinned native binary installer with embedded per-platform SHA-256 values, dry-run default, backup, and atomic replacement.
- Least-privilege OCR wrapper that permits only version, delegation preview, and delegation rule commands under a temporary HOME and stripped environment.
- Source/security reference documenting npm lifecycle/update behavior, session persistence, telemetry, plugin authority, binary signing limitations, and Git compatibility.

### Changed

- Routed explicit code-review requests through `ocr-code-review` in `daily-dev`, `ROUTING.md`, `AGENTS.md`, and `AGENTS-snippet.md`.
- Made review-only requests read-only and required explicit approval before OCR-managed LLM review, code egress, plugin/MCP enablement, or fixes.

### Deliberately not enabled

- OCR-managed LLM mode as the default.
- The upstream native OpenCode plugin or MCP server.
- npm global installation, lifecycle scripts, detached auto-updater, persistent provider credentials, or persistent review sessions.

## 0.1.2 - Matt/Addy selective upstream refresh

Reviewed Matt Pocock `ed37663cc5fbef691ddfecd080dff42f7e7e350d` and Addy Osmani `7829ffd90d973b6325f5f12f1b1226dcace74443`, then absorbed only changes that strengthen the local OpenCode workflow without weakening HiGa's approval, isolation, or verification gates.

### Changed

- Expanded `zoom-out` into context-map and decision-map modes for multi-session/foggy efforts; decision tickets now resolve uncertainty before `to-issues` creates implementation tickets.
- Added change-history/YAGNI scoping to architecture reviews.
- Changed local issue drafts to one file per dependency-ordered issue.
- Simplified Matt setup prompts by detecting triage availability and monorepo context before asking questions.
- Added TDD stack discovery and repository-native command selection.
- Strengthened ADR convention detection across paths, filenames, formats, headings, and supersession rules.
- Added strict performance keep/revert rules with comparable measurements, variance checks, and an experiment ledger.
- Hardened dependency supply-chain guidance: authoritative installation boundary, immutable installs, install-script blocking/approval, reachability triage, provenance review, and no automatic forced remediation.
- Clarified that CI examples are illustrative and project-native commands must be discovered first.

### Validation

- Added validator self-tests.
- Fenced-code stripping now supports backtick and tilde fences.
- Router validation now rejects unknown skill references in `daily-dev` and `AGENTS-snippet.md`, while allowing the optional external `deepwork` coordinator.

### Deferred / rejected

- Did not import Matt's in-progress `batch-grill-me`, `to-questionnaire`, or `setup-ts-deep-modules` as top-level skills.
- Did not import Codex/Claude plugin metadata into the OpenCode pack.
- Did not import Addy's full eval harness; only deterministic validator ideas relevant to this pack were adapted.
- Did not auto-install the refreshed pack into active OpenCode.

## 0.1.1 - Full workflow and safety audit

Audited all 35 skills, with deep revisions to `daily-dev` and `brainstorming`.

### Changed

- Expanded `daily-dev` into a complete lean router covering API, UI, security, performance, observability, CI/CD, source verification, adversarial review, PRDs/issues, handoff, and tiny-edit exceptions.
- Restored `brainstorming` collaboration gates: scope decomposition, one-question-at-a-time clarification, meaningful alternatives, explicit interactive design approval, autonomous `yolo` exception, isolated artifact writes, and review/handoff rules.
- Made PRD/issue publication local-first and explicitly approval-gated.
- Standardized research/design/plan artifact dates on ISO `YYYY-MM-DD`.
- Aligned `AGENTS.md`, `AGENTS-snippet.md`, `ROUTING.md`, and README routes with the router policies.

### Fixed

- Anchored installer exclusions so nested skill resources such as `huashu-design/scripts/` and `huashu-design/references/` are installed.
- Made rollback non-destructive by default; exact point-in-time deletion now requires `--exact`.
- Added `scripts/validate_pack.py` for frontmatter, name, link, and manifest/hash validation.
- Corrected stale manifest source-pack metadata and regenerated descriptions, hashes, and line counts.
- Added whole-pack Markdown-link and bundled-resource validation plus post-install source-to-target integrity verification.
- Replaced stale upstream skill names with canonical local routes and bundled missing accessibility, performance, security, and reviewer-orchestration references.
- Unified ADR discovery/default policy and documented `new-skill/` as the sole canonical source.

## 0.1.0 - Initial versioned OpenCode dev pack

Initial versioned release for HiGa's OpenCode developer workflow.

### Added

- Base pack copied from `docs/my-skill/opencode-dev-skills`.
- 35 skills total.
- Core daily workflow from local `new-skills`.
- Matt Pocock engineering skills already adapted in local core.
- Addy Osmani discipline overlays:
  - `api-and-interface-design`
  - `frontend-ui-engineering`
  - `security-and-hardening`
  - `performance-optimization`
  - `observability-and-instrumentation`
  - `ci-cd-and-automation`
  - `documentation-and-adrs`
  - `browser-testing-with-devtools`
  - `source-driven-development`
  - `doubt-driven-development`
- `AGENTS.md`, `AGENTS-snippet.md`, `ROUTING.md`, and `OPTIMIZATION.md` for OpenCode routing.
- `VERSION`, `manifest.json`, install/rollback scripts, and release notes.

### Safety policy

- This pack is source-of-truth in the Hermes repo, not directly active OpenCode config.
- Active OpenCode install should be done via `scripts/install.sh`, which creates a backup first.
- Rollback should be done via `scripts/rollback.sh <backup-dir>`.
- Do not overwrite active custom/plugin skills without reviewing diffs.
