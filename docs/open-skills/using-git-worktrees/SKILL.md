---
name: using-git-worktrees
description: Use when starting feature work, bug fixes, risky edits, plan execution, or subagent file changes - creates disposable git worktrees with baseline checks and safe handoff.
---

# Using Git Worktrees

## Purpose

Use git worktrees as disposable labs: isolate risky work, preserve the main workspace, then hand off the result safely.

Lifecycle:

```text
create → verify → work → review diff → handoff → cleanup later
```

## When to Use

Use before:

- feature implementation
- bug fixes that edit files
- saving non-trivial research/design/plan artifacts into the repo
- executing plans
- subagent-driven development
- risky refactors/migrations/generated changes
- prototypes or issue drafts written inside the repo
- any work where main workspace must stay clean

Do not use for:

- read-only analysis
- tiny edits the user explicitly wants on current branch
- git-only operations requested on current branch

## Worktree Location Policy

Default to a repo-local worktree directory:

```text
<repo-root>/.worktrees/<safe-branch-name>
```

This keeps the isolated workspace close to the source tree so IDE/OpenCode compare plugins can compare the current branch workspace against the worktree by path.

Before using `.worktrees/`, run `git check-ignore -q .worktrees/`. If it is not ignored, do not silently edit tracked `.gitignore` before isolation. Choose one: ask approval for a tiny `.gitignore` bootstrap edit, add `.worktrees/` to `.git/info/exclude` and disclose the local-only change, or use an external isolated worktree. If the project has editor settings, exclude `.worktrees/**` from normal search/indexing to avoid duplicate-file noise while still allowing explicit comparison.

Do not use a far-away global worktree path unless the user asks. If the current IDE/plugin cannot compare external folders, repo-local `.worktrees/` is preferred.

## Creation Checklist

1. Identify repo root and current branch.
2. Check working tree status.
3. Verify `.worktrees/` is ignored; resolve the bootstrap case using the policy above before creating it.
4. Create branch/path under `<repo-root>/.worktrees/<safe-branch-name>`.
5. If practical, add editor/search excludes for `.worktrees/**` without blocking explicit folder comparison.
6. Write a short `.expires` marker when useful.
7. Install/hydrate dependencies only if project config indicates it.
8. Run the smallest reliable baseline check.
9. Report path, branch, base, original workspace status, and baseline result.

## Isolation Verification

Before the first edit, prove the active shell/session is inside the isolated workspace:

```bash
pwd
git branch --show-current
git worktree list
git status --short
```

Expected:

- path is under `<repo-root>/.worktrees/<safe-branch-name>` or another user-approved isolated copy
- branch is not `main` / `master` for non-trivial implementation
- original workspace status is known and not being overwritten
- baseline failure, if any, is recorded before new changes

If verification fails, stop before editing and switch/create the worktree. Do not treat "I created a worktree earlier" as enough; edits and tests must actually run there.

## Rules

- Never work in main/master for non-trivial implementation.
- Keep edits and tests inside the worktree.
- Do not auto-merge.
- Do not delete worktree until user confirms or work is merged/abandoned.
- If baseline checks fail before changes, report as pre-existing and ask whether to continue.
- Keep temporary scripts, logs, generated scratch files, and debugging artifacts out of the final diff unless they are intentional deliverables.
- For IDE/plugin comparison, report both paths: the original workspace path and the `.worktrees/<safe-branch-name>` path. If comparing against uncommitted changes in the original workspace, use the IDE folder compare/plugin; normal `git diff <branch>...HEAD` only compares committed branch history.

## Fallbacks and Blockers

If this is not a git repository, create an isolated copy/workspace instead and report the limitation.

If worktree creation fails, stop before editing and report:

- repo root
- current branch/status
- attempted path/branch
- error
- safest fallback proposal

If the original workspace has uncommitted changes, do not overwrite, clean, or stash them unless the user asks. Create the worktree from the current HEAD unless the user explicitly asks to include local changes.

## Handoff

```markdown
Worktree ready: <absolute-path under repo-root/.worktrees/>
Compare from: <original workspace absolute-path>
Branch: <branch-name>
Base: <base-branch-or-commit>
Original workspace status: <clean / dirty summary>
Isolation type: repo-local git worktree / copied workspace / existing approved workspace
Baseline: <passed / failed / skipped with reason>
Next: <what will happen there>
```

Completed work:

```markdown
Completed in: <absolute-path>
Branch: <branch-name>
Verification: <commands/checks and results>
Review: <diff summary>
Merge status: waiting for user review
```
