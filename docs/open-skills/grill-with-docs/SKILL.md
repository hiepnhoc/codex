---
name: grill-with-docs
description: Use when requirements, product language, or design direction are ambiguous - interviews the user one decision at a time, checks code/docs, sharpens domain terms, and updates CONTEXT.md/ADRs inline.
---

# Grill With Docs

## Purpose

Reach shared understanding before design or implementation.

This is not a generic Q&A. It is a focused grilling session that resolves the decision tree one branch at a time.

## When to Use

Use when:

- user request has multiple plausible meanings
- product/domain terms are vague or overloaded
- UX/business behavior is not clear from code
- architecture choice depends on a human preference or tradeoff
- the user asks to stress-test a plan/design

Do not use when:

- the answer is discoverable from the codebase or docs
- the task is mechanical and low-risk
- the user explicitly requested autonomous execution and the intake gate is already sufficient

## Rules

1. Ask one question at a time.
2. For each question, provide your recommended answer.
3. If code/docs can answer it, inspect them instead of asking.
4. Use existing `CONTEXT.md` and ADRs to challenge vague language.
5. Capture resolved terms immediately; update `CONTEXT.md` once the workspace guard is satisfied.
6. Offer ADRs sparingly, only for hard-to-reverse surprising tradeoffs.

## Workspace Guard

Questions and read-only inspection may happen in the current workspace. Before updating `CONTEXT.md`, ADRs, or other repo files for non-trivial work, switch to an approved isolated workspace/worktree. If isolation is not ready, keep resolved terms/decisions in the session summary and apply them after the workspace gate.

## Process

### 1. Load Context

Read:

- `CONTEXT.md` or `CONTEXT-MAP.md`
- relevant `docs/adr/`
- nearby code that defines the domain behavior

### 2. Identify Decision Tree

List internally:

- unclear terms
- product decisions
- technical decisions
- edge cases
- acceptance criteria gaps

### 3. Ask One High-Leverage Question

Format:

```text
Question: [specific decision]
Why it matters: [impact]
Recommended answer: [default based on code/docs]
Alternatives: [brief]
```

Wait for the user before continuing.

### 4. Capture Durable Knowledge

When resolved:

- update `CONTEXT.md` for domain language
- offer ADR if the decision is durable and surprising
- record rejected alternatives when useful

## Completion

Stop when:

- the goal is testable
- domain terms are unambiguous
- acceptance criteria are clear enough for planning
- remaining unknowns are technical facts discoverable by research/code reading

Return:

```markdown
Grill summary:
- Resolved decisions:
- Canonical terms:
- Acceptance criteria:
- Context/ADR updates:
- Remaining technical research:
```
