---
name: to-srs
description: Use when the user invokes $to-srs or asks for an SRS (đặc tả, tài liệu SRS) of a feature, during or after implementation - creates or updates one Vietnamese SRS file per feature from evidence (Jira ticket, approved design, migrations, API definitions, the actual diff), never from guesses.
---

# to-srs: one SRS file per feature, generated from evidence

Produces `docs/srs/<TICKET>-<slug>.md` following [TEMPLATE.md](TEMPLATE.md). The same
procedure serves both moments: a draft right after design approval, and the as-built
version once the code exists. If the file is missing, create it; if it exists, update it.

You (the session model) write the SRS yourself. It is a document artifact like the design
and plan files, not a `dev` task. Do not spawn `dev` for it. When tracing the code needs
more than a handful of reads, spawn `explore` agents (read-only, parallel) and write from
their `file:line` answers.

Write the SRS in Vietnamese with diacritics. Keep identifiers (table, column, endpoint,
class names) exactly as in the code.

## 1. Fix the scope

Resolve these mechanically, then announce one line:
`to-srs scope: ticket <KEY|none>, range <A..B> (<n> files), design: <path|none>`.

- **Ticket key**: the user's message → the branch name → commit subjects in the range.
  None found: continue, and put `CẦN ĐIỀN` in "Mã dự án".
- **Change range**: a range, branch or commit list given by the user wins. Otherwise
  `git merge-base HEAD <default-branch>`..`HEAD`, plus uncommitted changes
  (`git status --porcelain`).
- **Empty range** (already merged, or sitting on the default branch): find the feature's
  commits with `git log --grep=<KEY>`. Still nothing: ask the user one question for the
  commit range or branch, and stop until answered. Never describe the whole repository
  as if it were the feature.
- **Design artifact**: `.agents/tasks/*-design.md` and `*-plan.md` matching the ticket or
  topic, when present.

## 2. Collect evidence

Sources, strongest first. On conflict the stronger source wins, and the conflict is
listed in the report:

1. code in the change range (handlers, clients, config, log and metric calls)
2. migration files
3. API definitions (OpenAPI/Swagger files, route tables, controllers)
4. the approved design / plan artifact
5. this conversation
6. the Jira ticket

Where code does not exist yet (draft before implementation), the approved design is the
source: fill the section from it and end the section with the line
`_Theo thiết kế, chưa có code._` Remove that line once the code backs the section.

Jira: read the ticket with the `jira` MCP server (read-only calls) for the title,
description and BRD link. If the server is unavailable, use `CẦN ĐIỀN`. Do not comment
on, transition or edit a ticket; posting the SRS link back is a protected action that
needs the user's explicit approval.

## 3. Locate the file

- Follow an existing convention if the repo has one: `git ls-files | grep -i srs`.
- Default: `docs/srs/<KEY>-<kebab-slug>.md`; without a ticket key,
  `docs/srs/<YYYY-MM-DD>-<kebab-slug>.md`.
- A file for this ticket already exists → update it in place (section 5).

## 4. Fill the sections

Copy [TEMPLATE.md](TEMPLATE.md), keep every heading in its order, then fill:

| Section | Source and rule |
|---|---|
| Thông tin tài liệu | Name, ticket, BRD link from Jira. "Người soạn" = `git config user.name`. "Người review" = `CẦN ĐIỀN` unless the user named one. |
| Mục đích | 1–3 sentences: what the feature does, for whom, on which channel. |
| Hệ thống liên quan | One row per system the code in range calls or is called by. "Phương thức kết nối" = the protocol the client code or config actually uses. "Đầu mối" = `CẦN ĐIỀN` unless known. |
| System flow | Mermaid `flowchart`. Every node appears in "Hệ thống liên quan" and every row there appears as a node. Edge labels = real protocols. |
| Sequence diagram | Mermaid `sequenceDiagram` with `autonumber`. Trace the real call chain from the entrypoint down. Include the failure branches the code handles (`alt`/`else`): validation, auth/OTP failure, timeout, downstream error, compensation. |
| ERD | Mermaid `erDiagram` of the tables the feature creates or changes, plus the tables they reference. |
| Index | One row per index created or changed, with the query it serves. |
| DB Table | DDL copied verbatim from the migration files for every table created; real `ALTER` statements for tables changed. Never rewrite DDL from memory. |
| Đặc tả API | Swagger link or repo path, plus one row per endpoint added or changed. |
| Log, giám sát, cảnh báo | Logs and metrics actually emitted in the range. Dashboards and thresholds from the design or conversation; otherwise `CẦN ĐIỀN`. |
| References | Diagram links, the main files of the feature, the design/plan artifact paths. |
| Phụ lục | Business rules (limits, fees, time windows) with where the code enforces them; `stateDiagram-v2` for a status column; error-code table. Keep only sub-sections that have evidence; drop the whole appendix if none do. |

## 5. Hard rules

1. **No evidence, no claim.** Every section ends with `<!-- nguồn: path:line, path:line -->`
   listing what it was written from (a design path or "Jira <KEY>" counts). What cannot be
   sourced is written as `CẦN ĐIỀN: <điều cần biết>`. Never fill a gap with a plausible guess.
2. **Not applicable is stated, not deleted.** A section the feature does not touch reads
   `Không áp dụng — <lý do một dòng>`.
3. **This repository only.** Describe other systems only at the boundary this repo
   touches. Internals of another repo are `CẦN ĐIỀN` unless the user gave its path.
4. **No secrets.** No tokens, passwords, keys or connection strings, even when they
   appear in the code or config you read.
5. **Updating an existing file.** Replace stale content in place; do not append a second
   version of a section. Add one "Lịch sử thay đổi" row (version +0.1, today via
   `date +%d/%m/%Y`, author, one line on what changed). Never set "Trạng thái" to
   `Đã duyệt`; if it was `Đã duyệt` and technical content changed, set it to
   `Đang review` and say so in the report.
6. **Remove the `hướng dẫn` comments** from the output; keep the `nguồn` comments.
7. **Mermaid must parse.** Quote labels containing punctuation, no blank diagram blocks.
   If `mmdc` is installed, render each block once; otherwise re-read each block for syntax.

## 6. Where to write

The SRS is durable documentation and travels with the feature's code:

- on the feature branch or its worktree → write there;
- on the default branch (feature already merged) → follow the daily-dev Workspace Write
  Policy: create a worktree/branch first, unless the user explicitly asked for the
  current checkout.

Do not commit, push or open a PR unless the user asks.

## 7. Verify

1. Self-check: every heading present; no leftover template placeholder (`<...>`); every
   system in the flow is in the table; every table in the ERD has DDL or is marked as
   pre-existing; every `CẦN ĐIỀN` says what is needed.
2. When `spawn_agent` is available, spawn `reviewer` (`fork_turns="none"`) with the SRS
   path, the change range and this instruction: "Check each SRS section against its
   `nguồn` and the diff. Report CONTRADICTS-CODE, CLAIM-WITHOUT-EVIDENCE, and MISSING
   (in the diff but absent from the SRS), each with file:line." Fix the findings and
   send it back once; after 2 failed rounds, list the open findings in the report.
   If spawning is unavailable, do the same pass yourself and say "SRS review: self".

## 8. Report

```markdown
to-srs result:
- File: <path> (created | updated), version <x.y>, status <...>
- Scope: ticket <KEY>, range <A..B>
- CẦN ĐIỀN: <each open item, one line>
- Không áp dụng: <sections>
- Theo thiết kế, chưa có code: <sections, if any>
- Conflicts between sources: <which won>
- Review: <reviewer PASS/FAIL rounds | self>
```
