---
name: simplify
description: Use when behavior works but code is harder than necessary, or during review cleanup - simplifies code for clarity while preserving exact behavior.
---

# Simplify

## Purpose

Make code easier to read, understand, modify, and debug without changing behavior.

The goal is not fewer lines. The goal is lower cognitive load.

## When to Use

Use when:

- feature works and tests pass but implementation feels heavy
- review flags readability/complexity
- code has deep nesting, duplication, unclear names, or scattered logic
- refactoring time-pressure code
- consolidating related logic within the task scope

Do not use when:

- code is already clear
- you do not understand behavior yet
- simpler version would measurably hurt performance-critical code
- module is about to be replaced entirely
- broad architecture change is needed (`improve-codebase-architecture` instead)

## Principles

1. Preserve behavior exactly.
2. Follow project conventions.
3. Prefer clarity over cleverness.
4. Maintain useful abstractions.
5. Scope to changed/relevant code.
6. Verify after each meaningful simplification.

## Boundary With Architecture Refactor

Use `simplify` for local behavior-preserving cleanup.

Use `improve-codebase-architecture` when the problem is structural:

- shallow modules
- poor seams
- hidden coupling
- hard-to-test behavior
- concepts scattered across files
- interface nearly as complex as implementation

## Workspace Rule

If simplification requires repository edits and you are not already in an isolated worktree/workspace, use `using-git-worktrees` first unless the user explicitly requested editing the current branch.

## Process

### 1. Understand Before Touching

Answer:

- what is this code responsible for?
- who calls it?
- what are edge cases and side effects?
- what tests define behavior?
- why might it be written this way?

### 2. Identify Opportunities

Signals:

- deep nesting
- long mixed-responsibility functions
- duplicated logic
- misleading names
- boolean flag arguments
- repeated conditionals
- pass-through wrappers
- dead code

### 3. Apply Incrementally

For each change:

1. make one simplification
2. run targeted verification
3. keep only if behavior is preserved

### 4. Verify

Checklist:

- [ ] tests/build/typecheck/lint pass or limitations reported
- [ ] no behavior/error/side-effect change
- [ ] no unrelated refactors
- [ ] result is easier to review
- [ ] project conventions still match

## Handoff

```markdown
Simplified:
- [files/areas]

Preserved behavior:
- [verification]

Not changed:
- [explicit non-goals]
```
