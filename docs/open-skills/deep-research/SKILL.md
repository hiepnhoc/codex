---
name: deep-research
description: Use when a technical approach is new, high-risk, weakly understood, or current code may need refactor - gathers evidence, alternatives, tradeoffs, and failure modes before design.
---

# Deep Research

## Purpose

Answer:

```text
What approaches exist for this problem, what evidence supports them, and what tradeoffs matter for this project?
```

Research informs decisions. It does not make final product/design decisions; `brainstorming` does that against project reality.

## When to Use

Use when:

- feature is NEW and no project pattern exists
- current implementation is weak and may need refactor
- library/framework/architecture choice matters
- failure modes are expensive
- user asks for research or comparison
- you are tempted to say "industry standard" without evidence

Do not use when:

- extending healthy existing code with clear local patterns
- answer is a small API lookup
- the task is mechanical

## Opening Check

Before internet research:

1. Search existing `.agents/tasks/*-research.md` or docs for prior work.
2. Read domain context (`CONTEXT.md`, ADRs) if relevant.
3. Do a lightweight codebase scan to classify:

| Case | Condition | Action |
|---|---|---|
| NEW | No relevant implementation | Research approaches |
| REFACTOR | Exists but poor/fragile | Research better patterns |
| EXTEND | Healthy pattern exists | Stop and use `brainstorming` to extend project pattern |

## Evidence Quality

Prefer:

- official docs/source code
- major OSS implementations
- production case studies/postmortems
- benchmarks with methodology
- issue discussions showing failure modes

Treat blog opinions as leads, not conclusions. Do not cite AI summaries as evidence.

Cross-check important claims with multiple independent sources when possible.

## Process

### 1. Understand Project Constraints

Before internet research, understand the project area enough to avoid generic advice.

Capture:

- project purpose in 2-3 sentences
- affected domain/component and key files
- current implementation state, or confirmation it does not exist
- relevant constraints: scale, latency, data safety, team, infra, language/tooling
- existing docs/rules/ADRs that constrain the topic

If you cannot name the affected components and constraints, keep reading local code/docs before researching externally.

### 2. Research Broadly

Use diverse queries and source types. For substantial technical decisions, use at least five distinct search angles or source-discovery passes unless enough high-quality project/local evidence already exists.

Stop only when you have:

- 2-3 viable approaches, or a justified reason only one exists
- evidence from multiple source types
- known downsides/failure cases, not only success stories
- applicability signals for this project
- enough constraint detail for `brainstorming` to decide fit

For GitHub examples, inspect implementation files when possible, not only README text. For performance or reliability claims, prefer benchmarks, source, issues, postmortems, or production reports over marketing pages.

### 3. Compare Approaches

Produce a table:

| Aspect | Approach A | Approach B | Approach C |
|---|---|---|---|
| Used by |  |  |  |
| Strengths |  |  |  |
| Weaknesses |  |  |  |
| Best for |  |  |  |
| Fit with this project |  |  |  |
| MVP effort |  |  |  |
| Failure modes |  |  |  |

### 4. Quality Review and Handoff to Brainstorming

Do not choose blindly. State which options seem promising and what decisions remain.

Before final output for high-risk, architectural, migration, security/privacy, public API, or refactor research, run an independent review when available, or do a separate pass checking:

- source quality: no AI summaries or single blog posts as conclusions
- failure coverage: each approach lists downsides and operational risks
- cross-validation: important claims have multiple sources when possible
- comparison quality: approach table uses evidence, not vibes
- project applicability: similarities, mismatches, and unknowns are explicit
- decision boundary: final design/product decision is left to `brainstorming`

If review finds gaps, fill them and review again. Stop after two failed review rounds and record remaining gaps in `Open Questions for Brainstorming`.

## Output

Save when possible to the isolated worktree/workspace (create one before a repo-local write):

```text
.agents/tasks/YYYY-MM-DD-<topic>-research.md
```

Structure:

```markdown
# [Topic] Research

## Domain Understanding
## Research Question
## Approaches Compared
## Evidence
## Failure Cases
## Applicability to This Project
## Open Questions for Brainstorming
## Sources
```
