---
name: diagnose
description: Use when debugging hard bugs, failing tests, broken behavior, flaky issues, or performance regressions - builds a fast feedback loop before fixing.
---

# Diagnose

## Core Rule

Do not fix before you have a feedback loop.

A feedback loop is a fast, repeatable pass/fail signal that proves the bug exists and later proves it is fixed.

## Phase 1: Build Feedback Loop

This is the skill. Everything else consumes the signal.

Try in roughly this order:

1. failing test at the correct seam
2. CLI/script reproduction with fixture input
3. HTTP/curl reproduction against a dev server
4. browser automation for UI bugs
5. replay captured request/log/trace
6. throwaway harness around the affected code path
7. stress/fuzz loop for flaky bugs
8. bisection harness for commit/version/config regressions
9. differential comparison old vs new version/config
10. structured HITL script if human clicking is unavoidable

Improve the loop until it is:

- fast
- deterministic or high-probability for flakes
- specific to the user-reported symptom
- runnable by the agent

For non-deterministic bugs, the goal is to raise reproduction probability enough to debug: loop, parallelize, stress, pin time, seed randomness, isolate filesystem/network.

If no correct seam exists, state that explicitly. That is an architecture finding.

If no loop can be built, stop and ask for the missing artifact/access: environment, HAR/log/core dump, screen recording, or permission for temporary instrumentation.

## Phase 2: Reproduce

Run the loop and confirm:

- failure matches the user-reported bug
- exact symptom is captured
- failure reproduces reliably enough to debug

Do not continue to root-cause analysis until reproduction exists or the absence of a seam is documented.

## Phase 3: Hypothesize

Generate 3-5 ranked hypotheses before testing any.

Each hypothesis must be falsifiable:

```text
If X is the cause, then observing/changing Y should produce Z.
```

Avoid single-hypothesis anchoring. If the user is present, show the ranked list briefly because domain knowledge often reorders it; if AFK, proceed with your ranking.

## Phase 4: Instrument

Probe one hypothesis at a time. Change one variable at a time.

Prefer:

1. debugger / REPL inspection
2. targeted logs
3. narrow assertions/checks

If adding logs, tag with a unique prefix:

```text
[DEBUG-xxxx]
```

Never "log everything and grep".

For performance regressions, establish a measurement baseline before changing code: timing harness, profiler, query plan, or benchmark with method noted.

## Worktree Gate Before Persistent Fixes

Read-only reproduction and temporary investigation may happen in the current workspace.

Before adding a persistent regression test, editing production code, updating fixtures, or deleting debug artifacts tracked by the repo, use `using-git-worktrees` unless already in an approved isolated workspace.

If the fix grows beyond a focused change, hand off to `writing-plans` or `executing-plans` rather than improvising a broad implementation inside `diagnose`.

## Phase 5: Fix + Regression Test

If a correct test seam exists:

1. turn the minimized repro into a failing test
2. watch it fail for the expected reason
3. apply the smallest fix
4. watch it pass
5. rerun the original feedback loop

If no correct seam exists, document why and consider `improve-codebase-architecture` after the immediate fix.

## Phase 6: Cleanup + Postmortem

Before declaring done:

- original repro no longer fails
- regression test passes, or missing seam is documented
- debug logs removed by searching the unique prefix
- throwaway harness deleted or clearly marked
- root cause summarized
- prevention/architecture follow-up noted if appropriate

## Handoff

```markdown
Bug:
Feedback loop:
Root cause:
Fix:
Regression coverage:
Verification:
Remaining risk:
Architecture follow-up:
```
