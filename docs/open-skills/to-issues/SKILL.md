---
name: to-issues
description: Use when turning a PRD, plan, or design into issue-tracker tickets - breaks work into independently grabbable vertical-slice issues with acceptance criteria and dependencies.
---

# To Issues

## Purpose

Break a plan/spec/PRD into vertical-slice issues that agents or humans can pick up independently.

## When to Use

Use when:

- user wants implementation tickets
- plan is too large for one PR
- work should be distributed to AFK agents/humans
- dependencies need to be explicit

## Process

### 1. Gather Context

Read source material fully:

- PRD/design/plan
- existing issue/comments if referenced
- domain context and ADRs
- current codebase context if not already known

Use the project's domain vocabulary and respect relevant ADRs.

### 2. Draft Vertical Slices

Each issue should deliver a narrow complete behavior, not a horizontal layer.

For each issue:

- title
- type: AFK or HITL
- dependencies
- user stories/requirements covered
- acceptance criteria

Prefer many thin slices over few thick slices.

Rules:

- each slice cuts through all required layers end-to-end
- a completed slice is demoable or independently verifiable
- blockers must be explicit
- avoid stale file paths/code snippets unless a prototype produced a decision-rich snippet that prose cannot capture

### 3. Review With User

Ask:

- granularity too coarse/fine?
- dependencies correct?
- should slices merge/split?
- HITL vs AFK correct?

Iterate until the breakdown is approved before publishing externally.

### 4. Publish or Write Files

Do not create or modify external issue-tracker tickets without explicit user approval.

If approval is absent, write local markdown issue drafts in the isolated worktree/workspace and report paths. Use one file per issue under:

```text
.scratch/<feature-slug>/issues/<NN>-<issue-slug>.md
```

Number files in dependency order, starting at `01`. Each file must identify its blockers by number/title. Do not collapse the set into one giant `tickets.md`; separate files are easier for humans and agents to claim, review, and hand off independently.

If a tracker is configured and approval is given, publish one issue per file in dependency order and include created links.

Publish in dependency order so blockers can reference real issue identifiers.

Do not close or modify parent issues unless explicitly requested.

## Issue Template

```markdown
# [Title]

## Local ID

[NN]

## Parent

[optional]

## Type

AFK / HITL

## Status

ready-for-agent / ready-for-human

## What to build

[End-to-end behavior, not layer-by-layer implementation]

## User stories / requirements covered

- [source requirement]

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

None / [links]

## Verification hints

[How an agent/human can prove this slice is done]

## Notes

[Domain terms, ADRs, prototype decisions, risks]
```
