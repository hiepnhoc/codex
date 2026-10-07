---
name: domain-context
description: Use when starting work in a repo, clarifying feature language, or before design/planning - reads or creates CONTEXT.md and ADRs, aligns domain vocabulary, and records durable decisions.
---

# Domain Context

## Purpose

Build shared language between user, codebase, and agent before design or implementation.

Good code work depends on using the project's actual domain language, not generic words invented by the agent.

## When to Use

Use before:

- feature design
- refactor planning
- architecture review
- ambiguous product/domain terms
- unfamiliar codebase work
- any task where naming or business meaning matters

Do not use for:

- tiny mechanical edits
- pure formatting changes
- one-line fixes with no domain meaning

## Workspace Guard

Discovery and vocabulary extraction may be read-only in the current workspace. Before creating or updating `CONTEXT.md`, `CONTEXT-MAP.md`, or ADRs for non-trivial work, switch to an approved isolated workspace/worktree. Until then, buffer proposed updates in the session and report them as pending rather than writing to the main workspace.

## Process

### 1. Discover Domain Docs

Look for:

- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/adr/`
- package-specific `CONTEXT.md`
- package-specific `docs/adr/`
- `docs/agents/domain.md` if Matt-style setup exists

If none exist, do not create immediately. Create lazily when a domain term or decision is actually resolved.

### 2. Extract Existing Vocabulary

Read relevant docs and identify:

- canonical terms
- overloaded terms
- deprecated terms
- important workflows
- business invariants
- existing ADR decisions

### 3. Compare User Language With Code

When the user says a vague or conflicting term:

- surface the conflict
- propose a canonical term
- ask only if ambiguity changes product behavior or implementation

Example:

```text
You said "account", but CONTEXT.md distinguishes CustomerAccount from LoginUser. Which one do you mean?
```

### 4. Capture and Apply Context Updates

When a term is resolved, capture it immediately. Update `CONTEXT.md` once the workspace guard is satisfied.

Guidelines:

- include terms meaningful to domain experts
- avoid implementation details unless they are part of the domain language
- prefer concise definitions and examples
- mark unresolved ambiguity explicitly

### 5. ADR Rule

Create or offer an ADR only when all are true:

1. hard to reverse
2. surprising without context
3. a real tradeoff existed

Do not create ADRs for obvious or temporary decisions.

## Output

```markdown
Domain context summary:
- Context docs read:
- Canonical terms:
- Ambiguities resolved:
- ADRs relevant:
- Updates made:
- Open domain questions:
```
