---
name: brainstorming
description: Use when a non-trivial feature, behavior change, architecture choice, or research result needs to become an approved project-specific design before implementation planning.
---

# Brainstorming

## Purpose

Turn an idea, requirement, or research result into a decision-backed design that fits this project.

The output is not a loose list of possibilities. It is an approved design with explicit scope, chosen approach, rejected alternatives, integration points, risks, and a clean handoff to `writing-plans`.

## When to Use

Use for:

- non-trivial features or behavior changes
- architecture/refactor target-state decisions
- API/UI flows with meaningful product or technical tradeoffs
- turning `deep-research` findings into a project decision
- revising an existing design after codebase evidence invalidates it

Do not use for:

- tiny mechanical edits with clear acceptance criteria
- unknown bugs before `diagnose` establishes a signal
- pure implementation planning when an approved design already exists
- throwaway experiments whose purpose is only to answer one question (`prototype`)

## Hard Gate

For interactive work, do not write implementation code, scaffold the production solution, or invoke execution skills until the user approves the design.

Allowed before approval:

- read-only code/docs/history inspection
- clarifying questions
- official-source research
- disposable experiments outside the repository
- creating an isolated worktree before saving the approved design artifact

Exception: when called inside `yolo`, explicit section-by-section approval is not required after the `yolo` intake gate passes. The agent must still stop for unresolved product choices, protected decisions, or material scope changes. Independent/self-review is not permission for deploy, publish, destructive, paid, credential, privacy, or external-account actions.

## Inputs

- user feature idea or desired outcome
- existing PRD, issue, spec, or design
- `deep-research` / `source-driven-development` evidence
- codebase implementation and tests
- domain context and ADRs
- constraints, success criteria, and non-goals

## Workflow

### 1. Explore Project Reality

Before proposing a design, inspect the relevant:

- `CONTEXT.md`, `CONTEXT-MAP.md`, and ADRs
- implementation and tests, not only filenames
- package/tool configuration
- recent changes when they affect the target area
- existing interfaces, error semantics, and extension points

Read-only discovery may happen in the current workspace. Do not create repo artifacts there for non-trivial work.

### 2. Check Scope and Domain Alignment

Identify:

- canonical domain terms and conflicts with user wording
- goal, success criteria, constraints, and non-goals
- whether the request contains multiple independent subsystems
- product decisions that code/research cannot answer
- technical unknowns that should go to `deep-research` or `source-driven-development`

If the request is too large for one coherent design/plan, decompose it into sub-projects, explain dependencies, and brainstorm the first slice rather than producing a monolithic spec.

Use `grill-with-docs` when multiple product meanings remain. Ask one high-leverage question at a time and include a recommended answer. Do not ask the user for facts discoverable from files or tools.

If the request is already clear, do not manufacture questions. State the inferred assumptions and proceed to approaches.

### 3. Assess the Current Code Baseline

Classify each affected area:

| Verdict | Signal | Design action |
|---|---|---|
| GOOD BASELINE | cohesive, tested, extensible | extend the current pattern |
| NEEDS REFACTOR | works but is tangled, inconsistent, or hard to test | include a focused refactor/migration path |
| CRITICAL ISSUE | unsafe or structurally blocks the requested behavior | stop or route through `improve-codebase-architecture` |
| NEW | no relevant implementation exists | design from first principles; research when needed |

Assess cohesion, coupling, testability, data/control flow, error handling, compatibility, and natural extension points.

A working implementation is not automatically a good baseline. Do not copy bad structure solely for consistency.

### 4. Explore Approaches

For every meaningful design choice, propose 2-3 viable approaches with:

- how each fits current architecture and domain language
- benefits and tradeoffs
- failure modes and operational/security implications
- migration/compatibility cost
- MVP path and reversibility
- testing consequences

Lead with a recommendation and explain why it best fits this project.

Do not invent fake alternatives for trivial details. When only one approach is viable because of an ADR, compatibility rule, or verified constraint, state that evidence explicitly.

### 5. Present the Design for Approval

Scale the presentation to complexity. Cover the sections that matter, including:

- goals and non-goals
- chosen approach
- components/boundaries and integration points
- data/control flow
- API/UI behavior where relevant
- error handling and failure modes
- security/privacy/permissions where relevant
- migration, rollout, rollback, and compatibility where relevant
- testing and verification strategy
- risks, assumptions, and open questions
- alternatives rejected

For interactive work, present the recommended design and ask for explicit approval before writing the final repo artifact or transitioning to planning. For large designs, validate in logical sections rather than dropping an unreviewable wall of text.

If the user rejects or changes a section, revise the design; do not append contradictory alternatives as if all remain current.

### 6. Save the Approved Design

Before writing a design artifact into the repository, create/switch to an isolated worktree unless already in an approved isolated workspace.

Default path:

```text
.agents/tasks/YYYY-MM-DD-<task-brief>-design.md
```

User/project conventions override this path.

Recommended structure:

```markdown
# [Feature/Topic] Design

## Source and Approval
## Domain Language
## Current Code Baseline
## Goals
## Non-Goals
## Decision Summary
## Proposed Solution
## Components and Integration Points
## Data / Control Flow
## API / UI Behavior
## Error Handling and Failure Modes
## Security / Privacy / Permissions
## Migration / Rollout / Rollback
## Testing and Verification
## Alternatives Rejected
## Risks and Mitigations
## Assumptions
## Open Questions
## Handoff to Writing Plans
```

Record the approval source/date or note that the design ran under an explicit autonomous `yolo` intake.

### 7. Review the Written Design

Run a fresh pass or independent reviewer when available. Check:

- no `TBD`, `TODO`, contradictory decisions, or ambiguous requirements
- scope fits one implementation plan; otherwise decompose
- domain terms and file/module references are accurate
- every research option is chosen, rejected, or deferred with reasoning
- current baseline quality was assessed before reuse
- public interfaces, failure modes, migration/rollback, and tests are covered
- protected actions remain approval-gated
- `writing-plans` can produce exact tasks without guessing product behavior

For architecture, migration, security/privacy, public API, or high-risk designs, independent review is mandatory when reviewer tooling exists. Fix findings and review once more. After two failed rounds, record unresolved gaps instead of pretending the design is complete.

### 8. Handoff

For interactive work, report the saved path and ask the user to confirm the written design if the final artifact materially differs from the approved presentation.

Then invoke only `writing-plans` as the next implementation workflow. Route back to clarification/research/design if planning uncovers a material discrepancy.

## Existing Design Updates

When revising an existing artifact:

- replace stale sections instead of appending contradictory notes
- preserve still-valid decisions
- explicitly mark superseded decisions and migration/removal consequences
- update risks, non-goals, tests, and handoff sections
- re-obtain approval when product behavior, scope, public API, security/privacy, or migration changes materially

## Completion Report

```markdown
Brainstorming result:
- Design path:
- Approval mode: interactive / yolo intake
- Recommended approach:
- Alternatives rejected:
- Current baseline verdict:
- Review performed:
- Open questions/risks:
- Next skill: writing-plans
```
