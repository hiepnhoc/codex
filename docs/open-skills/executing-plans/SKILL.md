---
name: executing-plans
description: Use when executing implementation plans - works in isolation, validates plan assumptions against codebase reality, executes task-by-task, verifies, and performs a final quality gate.
---

# Executing Plans

## Purpose

Execute plans deliberately with codebase evidence.

A plan is input, not truth. Validate it against the real codebase before and during implementation.

Core loop:

```text
isolate → read plan → discover rules → verify assumptions → execute tasks → checkpoint review → quality gate → handoff
```

## When to Use

Use when:

- user provides implementation/TDD plan
- plan spans multiple files/tasks
- plan references project patterns that must be verified
- strict plan adherence matters

Do not use when:

- task is read-only analysis
- plan is too ambiguous to execute
- user wants planning/review only
- tasks are highly independent and subagent review is preferred (`subagent-driven-development` may fit better)

## Non-Negotiables

- use isolated worktree/workspace before edits
- read whole plan before implementing
- validate plan assumptions against codebase
- execute task-by-task
- run project-native verification
- stop for scope/behavior-changing conflicts
- final quality gate required
- do not commit/merge/push unless requested

## Process

### 0. Isolate

Use `using-git-worktrees` unless already in an approved isolated workspace.

### 1. Read Plan Completely

Extract:

- goal and user-visible behavior
- task list and dependencies
- files/domains expected to change
- test/verification expectations
- cleanup/migration requirements
- explicit stop points

### 2. Discover Rules

Read:

- AGENTS/CLAUDE/project instructions
- domain context and ADRs
- package-specific rules
- existing code/tests in affected areas
- build/test/lint configs

### 3. Validate Plan Against Codebase

Create a quick table:

| Plan says | Codebase evidence | Match? | Action |
|---|---|---|---|

Classify mismatches:

- plan stale
- codebase bad pattern
- intentional refactor
- ambiguous/user decision required

Do not silently choose when behavior, API, migration, or scope changes.

Pattern evidence rule: default to three real examples when available. Use two examples plus docs/config for small projects, or one sparse example only when you state the limitation. If examples conflict, classify them as current, deprecated, domain-specific, or outliers instead of blending them into a new style.

### Stop / Continue Policy

Continue by default through ordinary implementation, verification, and cleanup.

Stop and ask only when:

- plan/codebase conflict changes behavior, public API, migration path, or scope
- requirement is ambiguous or contradictory
- task requires new infrastructure, dependency, external account, deployment, destructive migration, credential, or production-sensitive action not already approved
- verification repeatedly fails after focused fixes
- user explicitly requested checkpoints

Do not stop for:

- ceremonial "should I continue?" approval
- progress updates that do not require a decision
- context-budget anxiety
- ordinary implementation choices covered by the plan and codebase evidence

### Automation Policy

Manual implementation is the default.

Automation is allowed only when the change is mechanical, scoped, reversible, validated by dry-run/diff, and followed by project-native verification. Do not use scripts/codemods to avoid understanding the task or to blindly transform business logic.

### 4. Execute Task-by-Task

For each task:

1. read task-specific code/tests
2. validate assumptions
3. write/adjust test first when applicable
4. implement smallest change
5. run targeted verification
6. document changed files and evidence

### 5. Checkpoints

Review after meaningful chunks:

- every ~3 medium tasks by default
- sooner after risky/public API/security/migration/refactor tasks

Use isolated reviewer when available; otherwise do manual review.

### Cleanup / Dead Code

Clean up only what the plan or implementation requires.

Delete replaced internal code when references are removed and verification passes. Deprecate instead of delete only when public API compatibility, external users, rollout safety, or migration windows require it. Never leave old and new paths coexisting without an explicit migration/removal plan.

Do not keep commented-out code, backup files, debug logs, temporary helpers, or generated scratch artifacts in the final diff.

### 6. Quality Gate

Check:

- all plan requirements done or blocked with reason
- discrepancies resolved/reported
- pattern evidence supports new code
- verification passed or limitations documented
- no unintended files/debug artifacts
- no unapproved dependencies/migrations/infrastructure
- cleanup safe

For high-risk, migration, public API, security/privacy, broad refactor, or repeatedly failing work, use an isolated reviewer/quality-gate worker when available. Otherwise perform a separate manual review pass against the checklist above.

Do not report success if broad checks fail, if critical review findings remain, or if the implementation only works by leaving old/new paths in conflict. Report the blocker and next decision needed.

## Handoff

```markdown
Implemented plan: [name]
Worktree: [path]
Branch: [branch]
Base: [base branch/commit]

Summary:
- [change]

Artifacts:
- Plan:
- Design/research, if used:

Plan coverage:
- [task] → done/blocked/changed with reason

Verification:
- [command] → pass/fail/skipped with reason

Risks:
- [none or explicit]

Next actions:
- [review/commit/PR/deploy/cleanup]
```
