---
name: writing-plans
description: Use when design is ready or implementation needs planning - creates vertical-slice TDD plans with 100% requirement coverage, codebase-verified gap analysis, pattern quality assessment, test contracts, task graphs, and execution-ready tasks. Also use when tempted to skip requirements, assume test details are obvious, trust design/codebase claims without verification, reuse patterns without assessing quality, write horizontal layer tasks, or create a monolithic plan without dependency boundaries.
---

# Writing Plans

## Purpose

Convert a design, PRD, or approved scope into an implementation plan that an executor can follow without guessing business logic, architecture, file paths, commands, test behavior, or review boundaries.

Core idea:

```text
Design is target state. Codebase evidence is current state. The plan bridges them with vertical-slice TDD tasks.
```

## Inputs

- design artifact, PRD, issue, or user-approved scope
- domain context and ADRs
- codebase evidence
- project-native test/build commands

## Start-of-Run Contract

Announce:

> "I'm using the writing-plans skill to create the implementation plan."

When called from `brainstorming`, treat the design artifact as the target-state source of truth. Read it completely, write the plan artifact, and return:

- plan path
- plan type: NEW / EXTEND / REFACTOR / MAINTAIN / MIXED
- task count
- execution recommendation
- blockers or open questions

## Non-Negotiables

1. Read the full design/spec before planning.
2. Extract 100% of requirements before writing tasks.
3. Verify every current-state claim against code.
4. Classify work: NEW, EXTEND, REFACTOR, MAINTAIN, or MIXED.
5. Assess existing pattern quality before reusing it.
6. Prefer vertical slices/tracer bullets over horizontal layer tasks.
7. Use one ordered task graph; avoid arbitrary phase buckets unless dependency/review boundaries require separate plan files.
8. Plan behavior tests before implementation details, but execute one test/one implementation at a time.
9. Use project-specific patterns, file paths, and commands.
10. Resolve or ask about design/codebase discrepancies before proceeding.
11. Include dependency graph, review points, cleanup/migration, and verification strategy.

## Feedback Loop

Do not proceed with assumptions.

| Situation | Action |
|---|---|
| Product/domain meaning is ambiguous | use `grill-with-docs` or ask the user |
| Design section is ambiguous | route back to `brainstorming` to update the design |
| Design appears technically infeasible | route back to `brainstorming` with codebase evidence |
| Fundamental domain/technical knowledge is missing | use `deep-research` |
| Design/code mismatch is ambiguous and significant | ask user whether it is intentional refactor or design oversight |
| Design explicitly proposes refactor | follow design as target state |
| Pattern baseline is critically unsafe | route to `brainstorming` / `improve-codebase-architecture` before planning |

## Process

### 1. Load Domain and Project Rules

Read:

- `CONTEXT.md` / `CONTEXT-MAP.md`
- relevant ADRs
- AGENTS/CLAUDE/project rules
- nearby tests and implementation patterns
- package/tool configs

Also discover project tooling before writing commands:

- build system: Makefile, Taskfile, package scripts, go.mod, Cargo.toml, pyproject.toml, etc.
- test framework and test file conventions
- lint/typecheck/format commands
- package-specific scripts
- existing CI commands if available

No generic commands. Every command in the plan must be verified from project files or existing docs.

### 1.5. Assess Pattern Quality

Before reusing existing code patterns, decide whether they are a good baseline.

| Verdict | Signal | Planning action |
|---|---|---|
| GOOD BASELINE | cohesive, tested, consistent, extensible | reuse project pattern |
| NEEDS REFACTOR | works but is inconsistent, hard to test, or weakly structured | follow only if consistency matters; flag technical debt/follow-up |
| CRITICAL ISSUES | anti-pattern blocks safe implementation | stop and route to `brainstorming` / `improve-codebase-architecture` |
| NEW | no relevant implementation exists | design task from first principles; research if needed |

Do not blindly copy bad patterns because "that's how the codebase does it." If the plan follows a weak pattern for consistency, say so explicitly and include the refactor note.

Default pattern evidence is three real examples when available. Use two examples plus docs/config for small projects, or one example only when the pattern is genuinely sparse and the plan states that limitation. If examples conflict, classify them as current, deprecated, domain-specific, or outliers; do not average conflicting patterns into a new style.

### 2. Requirement Extraction

Create a coverage table:

| # | Requirement | Source section | Type | Planned task |
|---|---|---|---|---|

Coverage must be 100% before tasks are final.

For long or complex specs, create a section inventory first:

| # | Section | Line range / anchor | Status |
|---|---|---|---|

Then extract requirements section-by-section. Do not proceed until every relevant section is complete.

No exceptions:

- Do not skip requirements because they seem small.
- Do not merge requirements without listing each one.
- Do not decide what is important/unimportant without evidence.
- Do not write tasks before extraction is complete.
- Do not proceed if coverage is below 100%.

Red flags:

- "This is obvious."
- "The executor will infer it."
- "This section is minor."
- "I read enough to understand."

If any red flag appears, stop and finish extraction first.

### 3. Work Classification

| Scope area | Classification | Design evidence | Codebase evidence | Planning consequence |
|---|---|---|---|---|

Rules:

- NEW: no relevant implementation exists
- EXTEND: healthy existing pattern exists
- REFACTOR: current structure/pattern intentionally changes
- MAINTAIN: small bug/cleanup within healthy code
- MIXED: multiple areas; classify each task separately

No-hybrid rule: a task may not silently mix old and new patterns. If work touches both, label it as migration, adapter removal, cleanup, or replacement, and state the removal/compatibility strategy.

If classification is unclear, stop and resolve it before writing implementation tasks.

### 4. Gap Analysis

Compare current state vs target state. Verify current state by reading/searching code.

Classify discrepancies:

| Type | Signal | Action |
|---|---|---|
| Intentional refactor | design explicitly says rename/replace/restructure/migrate/remove | follow design |
| Design error | design references nonexistent thing casually or assumes wrong current state | send back to `brainstorming` |
| Ambiguous | impact is significant and intent unclear | ask user |

Every current-state claim needs evidence. If evidence is missing, the claim is not allowed in the plan.

### 4.5. Interface and Behavior Contract

Before task planning, define the public/project-standard interface each slice will exercise.

Ask or document:

- What public interface changes are required?
- Which behaviors matter most?
- Which behaviors are critical paths or complex logic?
- Which edge cases are true requirements?
- What should remain an implementation detail?
- Can the interface be smaller or deeper?

Prefer deep modules: small interface, implementation complexity hidden behind it, tests crossing the same seam callers use.

For testability:

- accept external dependencies instead of creating them internally
- return observable results where practical
- keep method/parameter surface area small
- avoid exposing internals only to make tests possible

### 5. Vertical Slice Planning

Prefer tasks that deliver one narrow behavior end-to-end.

Bad horizontal tasks:

- add all schema
- add all API
- add all UI
- add all tests

Good vertical tasks:

- user can create one draft order through public API with validation and persistence
- invalid payment method returns domain error and does not persist

First implementation task should be a tracer bullet whenever possible: one happy path that proves the full integration path.

### 5.5. Task Graph and Batching

Every plan must include a task graph.

Use a single ordered task list by default. Granular plans with 10-20+ tasks are acceptable when that improves execution clarity. Do not collapse tasks merely to reduce length, and do not add "Phase 1/2/3" buckets as decoration. Split into master/sub-plan files only when dependencies, parallel work streams, ownership, or review boundaries make execution safer.

For each task, state:

- dependencies
- whether it can run in parallel
- review/checkpoint timing
- whether it is safe to batch

Batch only when all are true:

- tasks are independent
- tasks are adjacent or naturally grouped
- tasks touch non-overlapping files or safe areas
- each task can be verified locally
- merge conflicts are unlikely
- each task remains understandable on its own

Do not hide dependency boundaries in prose.

### 6. TDD Contract

Do not plan horizontal RED/GREEN work.

Wrong:

```text
RED: write all tests
GREEN: implement all code
```

Right:

```text
Slice 1: RED test 1 → GREEN implementation 1 → optional refactor
Slice 2: RED test 2 → GREEN implementation 2 → optional refactor
Slice 3: RED test 3 → GREEN implementation 3 → optional refactor
```

For each vertical slice:

1. choose one behavior
2. write one behavior test through the public/project-standard interface
3. verify RED fails for the expected reason
4. implement only enough code for that test
5. verify GREEN
6. refactor only after GREEN
7. run targeted verification before moving to the next slice

RED correctness rule: the expected RED failure should prove the missing behavior or contract, not a bad test signature, wrong setup, unsupported harness, or mismatch with project conventions. Research naming, fixtures, and interfaces before writing the test contract.

Plan test contracts before implementation, but execution must remain one-test/one-implementation at a time.

Each planned test must include:

- behavior name
- public/project-standard interface used
- setup data
- action
- expected observable result
- expected RED failure reason
- targeted command

Before creating a new test file, harness, fixture style, or helper pattern, search existing tests in the affected area. Extend the existing project-standard test seam when possible. Create new test infrastructure only for a new domain or when the plan explicitly justifies why existing harnesses cannot exercise the behavior.

### 7. Cleanup / Dead Code

Identify replaced code and cleanup strategy.

Prefer deleting replaced internal code immediately. Deprecate instead of delete only when public API compatibility, external users, rollout safety, or migration windows require it.

If deprecation is required, include:

- why immediate deletion is unsafe
- compatibility window
- owner/trigger for removal
- explicit removal task or follow-up issue
- verification that old and new paths cannot silently diverge

Never leave old and new code coexisting without a migration/removal plan.

## Output

Save when possible to the isolated worktree/workspace:

```text
.agents/tasks/YYYY-MM-DD-<task-brief>-plan.md
```

Use one plan file when tasks are tightly coupled.

Use a master plan plus sub-plans when dependency boundaries, parallel work streams, ownership boundaries, or review boundaries make execution safer:

```text
.agents/tasks/YYYY-MM-DD-<task>-plan-master.md
.agents/tasks/YYYY-MM-DD-<task>-plan-<component>.md
```

The master plan must include sub-plan list, dependencies, execution order, parallel opportunities, review points, and instruction to read the master first.

Plan structure:

```markdown
# [Feature] Implementation Plan

## Plan Metadata
- Source design:
- Source research:
- Plan type: NEW / EXTEND / REFACTOR / MAINTAIN / MIXED
- Risk: Low / Medium / High
- Task count:
- Execution recommendation:

## Domain Context
- Context docs read:
- ADRs considered:
- Canonical terms:

## Requirement Coverage
| # | Requirement | Source section | Type | Planned task |
|---|---|---|---|---|
Coverage: X/X = 100%

## Work Classification
| Scope area | Classification | Design evidence | Codebase evidence | Planning consequence |
|---|---|---|---|---|

## Gap Analysis
| Component | Current state | Target state | Gap | Evidence |
|---|---|---|---|---|

## Pattern Quality and Evidence
| Pattern | Quality verdict | Examples | Rule to follow |
|---|---|---|---|

## Verification Strategy
| Check | Command | Evidence |
|---|---|---|

## Task Graph
| Task | Depends on | Can parallelize? | Review point |
|---|---|---|---|

## Tasks
### Task 1: [Tracer bullet]
- Classification:
- Requirement(s):
- Behavior:
- Public/project-standard interface:
- Files:
- Pattern evidence:
- RED test:
  - Setup:
  - Action:
  - Expected result:
  - Expected failure reason:
  - Command:
- GREEN implementation:
- Refactor check:
- Verification:
- Cleanup:

## Dead Code / Migration
| Code | Action | Task | Verification |
|---|---|---|---|

## Risks and Stop Conditions

## Plan Review Checklist

## Execution Recommendation
- Recommended mode: executing-plans / subagent-driven-development / to-issues
- Why:
- Parallelizable tasks:
- Sequential dependencies:
- Review checkpoints:
- Worktree/artifact location:
```

## Plan Review Before Handoff

Before finalizing, complete `reference/review-checklist.md`.

For REFACTOR, MIXED, migration, data model, public API, high-risk, or new-architecture plans, require independent review when available.

Reviewer must check:

- every requirement is covered
- classification is correct
- current-state claims are evidenced
- pattern quality was assessed before reuse
- tests verify behavior through public/project-standard interfaces
- no horizontal RED-all-tests/GREEN-all-code plan
- no hybrid old/new pattern remains without migration/removal
- task graph and review points are safe

Before finalizing the plan, read and apply:

- `reference/gap-analysis.md`
- `reference/vertical-slices.md`
- `reference/tdd-planning.md`
- `reference/review-checklist.md`

Do not treat these as optional background; they are the plan acceptance criteria.
