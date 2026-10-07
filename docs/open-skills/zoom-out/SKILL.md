---
name: zoom-out
description: Use when a code area needs broader repository/system context, or when an effort is too large or uncertain for one session and needs a map of decisions before implementation tickets.
---

# Zoom Out

## Purpose

Move up one or more abstraction levels before making a local decision.

Use the smallest mode that resolves the uncertainty:

1. **Context map** — understand modules, callers, data flow, domain terms, and system boundaries around a local code area.
2. **Decision map** — chart a large/foggy effort as questions whose answers make the path clear across sessions.

Do not turn unresolved decisions into implementation tickets. Decision mapping comes before `to-issues`.

## When to Use

Use when:

- a local file/change cannot be judged without broader architecture or caller context;
- the destination is known but the route is not;
- the work is too large for one session and important decisions remain unresolved;
- research, prototypes, or human choices must converge before planning.

Do not use when:

- the implementation path is already approved and only execution decomposition remains (`to-issues`);
- the task is a bounded bug with a reproducible signal (`diagnose`);
- a normal codemap is enough to explain repository structure (`codemap`).

## Mode A — Context Map

Read the project's domain glossary, ADRs, codemap, relevant modules, and callers. Return:

```markdown
# Context map: [area]

## Domain purpose
## Relevant modules and public interfaces
## Callers and downstream consumers
## Data/control flow
## Trust or persistence boundaries
## Relevant ADRs and constraints
## Local decision this context informs
## Unknowns still requiring research or user input
```

Use project domain vocabulary. Distinguish evidence from inference and link file paths/symbols.

## Mode B — Decision Map

A decision ticket resolves a question; it is not a slice of implementation. The map is complete when the path to the destination is clear enough for `brainstorming`, `writing-plans`, or `to-issues`.

### 1. Name the Destination

State in one or two lines what reaching the end means: an approved architecture, migration approach, product decision, PRD, or other planning-ready result.

### 2. Create the Map Locally First

Unless the user explicitly approves external tracker mutation, store the map and tickets in an isolated workspace:

```text
.scratch/<effort-slug>/decision-map.md
.scratch/<effort-slug>/decisions/<NN>-<decision-slug>.md
```

The map is an index, not a duplicate store:

```markdown
# Decision map: [effort]

## Destination
## Standing context and constraints
## Decisions resolved
- [decision title](decisions/NN-slug.md) — one-line result
## Frontier
- open, unblocked decision tickets
## Not yet specified
- in-scope fog that cannot yet be phrased precisely
## Out of scope
```

Each decision ticket contains:

```markdown
# NN — [decision title]

## Question
## Why it blocks the destination
## Type
research / prototype / grilling / prerequisite-task
## Blocked by
## Evidence or interaction required
## Resolution
## Consequences / follow-up decisions
```

### 3. Work the Frontier

The frontier is every open decision whose prerequisites are resolved.

- **Research:** use `deep-research` or `source-driven-development`; fact-finding is the agent's job, not a question for the user.
- **Prototype:** use `prototype` when a concrete artifact is needed to judge behavior or appearance.
- **Grilling:** use `grill-with-docs` for human preferences/tradeoffs, one high-leverage question at a time.
- **Prerequisite task:** use only when a concrete action must happen before a decision can be made. Protected/external actions still require approval.

Resolve one or more independent frontier tickets, record each answer in its ticket, add a one-line result to the map, then recompute the frontier. Do not pre-slice fog whose question cannot yet be stated precisely.

### 4. Stop at the Planning Boundary

Stop when:

- no unresolved decision blocks the destination;
- remaining work is implementation rather than discovery/decision-making;
- the map can hand off to `brainstorming`, `writing-plans`, or `to-issues` without guessing.

Do not silently publish the local map as GitHub/GitLab/Linear issues. External publication needs explicit approval.

## Completion Report

```markdown
Zoom-out result:
- Mode: context map / decision map
- Destination or local decision:
- Artifacts:
- Decisions resolved:
- Remaining frontier/fog:
- Recommended next route:
- External actions needing approval:
```
