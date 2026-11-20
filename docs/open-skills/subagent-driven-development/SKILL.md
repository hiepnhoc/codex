---
name: subagent-driven-development
description: Use when executing plans with independent tasks or needing fresh pattern validation - requires worktree isolation, dispatches implementation/review workers, fixes or documents issues, and runs final integration checks.
---

# Subagent-Driven Development

## Purpose

Execute a plan with fresh isolated workers while the main agent orchestrates, reviews, and keeps the workflow coherent.

Use this when independent tasks benefit from fresh context and per-task validation.

## When to Use

Use when:

- implementation plan exists
- tasks are mostly independent or batchable
- pattern validation matters
- review after each task/group is worth the cost
- user wants high safety over low token/cost

Do not use when:

- plan needs major revision
- tasks are tightly coupled and require one continuous context
- strict plan adherence with low overhead is preferred (`executing-plans`)
- user requested manual checkpoints after each step

## Non-Negotiables

1. Worktree isolation before any worker edits.
2. Each worker validates real codebase patterns before editing.
3. Tests/signatures must match project conventions.
4. Review after each task or safe batch.
5. Try to fix review issues, but document blockers and continue only when the remaining issue is isolated, non-critical, and does not invalidate downstream tasks.
6. Final integration quality gate.

## Process

### 0. Worktree Gate

Use `using-git-worktrees`. Do not dispatch editing workers on main/master or the original workspace.

Before dispatching any editing worker, verify and record:

- active path is the worktree/isolated workspace
- branch is not `main` / `master` for non-trivial implementation
- original workspace status is known
- baseline checks are passed or documented as pre-existing failures

If the parent or any worker discovers it is editing the original workspace, stop immediately, move work to the isolated workspace, and report the incident.

### 1. Load Plan and Rules

Read:

- full plan
- domain context and ADRs
- relevant project rules
- affected code/test patterns

Create a task list for all plan tasks.

### 1.5 Parent Orchestration Gate

Before dispatching workers, the parent agent must create:

| Task | Dependencies | Expected files/areas | Can run parallel? | Review mode | Risk |
|---|---|---|---|---|---|

Rules:

- Do not parallelize tasks that edit the same files, shared core abstractions, migrations, public APIs, permissions, auth, security, or deployment paths.
- Prefer sequential execution when dependency order is unclear.
- Give each worker a narrow task boundary and expected artifact/report.
- Parent owns integration, final diff review, and user handoff.
- Workers must not merge, push, deploy, delete worktrees, or perform irreversible actions unless explicitly approved.

### 2. Choose Execution Mode

| Task shape | Mode |
|---|---|
| simple independent tasks | parallel batch + group review |
| feature/business logic | one worker per task + review |
| risky migration/API/security | sequential + immediate review |
| ambiguous pattern | explore/research worker before implementation |

### 3. Worker Contract

Every worker must receive:

- worktree path
- exact task scope
- allowed files/areas, or explicit instruction to report if scope must expand
- relevant domain/project rules
- verification command expectations
- instruction not to commit/merge/push/deploy/delete worktrees

Every worker must stop and report instead of expanding scope when:

- required edits touch another worker's area
- task conflicts with project rules or plan assumptions
- protected action or external access is needed

Every implementation worker must report:

- task implemented
- pattern evidence found
- plan mismatch, if any
- tests added/changed
- files changed
- verification run
- deviations from plan and why

### 4. Review Contract

Reviewer checks:

- functional requirements
- pattern consistency
- test quality
- unintended changes
- cleanup/debug artifacts
- verification evidence

### 5. Fix Loop

If review fails:

1. dispatch focused fix worker or fix directly
2. rerun review
3. max 2 focused fix attempts per issue class
4. if still blocked, document blocker and continue only when safe

Do not continue past unresolved issues that affect shared contracts, public API behavior, data migrations, security/privacy, or tasks that downstream work depends on. Stop and ask instead.

### 6. Cleanup / Dead Code Gate

Before final integration, remove obsolete internal code that the plan or implementation replaced.

Rules:

- Delete replaced files/functions/exports/imports when compatibility does not require them.
- Do not add `deprecated`, `legacy`, `old*`, or commented-out copies as a substitute for deletion.
- Deprecate only for public API compatibility, external users, rollout safety, or migration windows; document the removal trigger.
- Verify no references remain and targeted checks pass after deletion.

### 7. Final Integration Gate

Run project-native broad checks and review combined diff.

The final gate must verify:

- all tasks are done or blocked with explicit reason
- per-task/group reviews passed or unresolved issues are safe and documented
- no unresolved issue affects shared contracts, public API behavior, data migrations, security/privacy, or downstream tasks
- no unintended files, debug artifacts, or scratch outputs remain
- broad verification passed or limitations are stated

## Handoff

```markdown
Subagent execution complete:
- Worktree:
- Branch:
- Tasks completed:
- Tasks blocked:
- Reviews:
- Verification:
- Deviations:
- Risks:
- Next action:
```

Load references as needed:

- `reference/batching.md` before any parallel dispatch
- `reference/subagent-prompts.md` before implementation worker dispatch
- `reference/review-prompts.md` before review worker dispatch
- `reference/failure-handling.md` when implementation, review, or verification fails
