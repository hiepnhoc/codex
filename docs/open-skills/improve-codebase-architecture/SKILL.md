---
name: improve-codebase-architecture
description: Use when codebase feels tangled, hard to test, hard to navigate, or user asks for architecture/refactor opportunities - finds deepening opportunities using module depth, seams, adapters, locality, and leverage.
---

# Improve Codebase Architecture

## Goal

Find refactor opportunities that make modules deeper, easier to test, and easier for agents/humans to navigate.

Do not implement immediately. Present candidates first.

## Vocabulary

Use terms from `LANGUAGE.md`:

- module
- interface
- implementation
- depth
- seam
- adapter
- leverage
- locality
- deletion test

Consistent language is part of the value. Use domain terms from `CONTEXT.md` for the product concepts and architecture terms from `LANGUAGE.md` for the refactor shape.

## When to Use

Use when:

- code is hard to understand or test
- concepts are scattered across files
- wrappers feel shallow/pass-through
- changes require touching unrelated modules
- bugs hide in orchestration/call sites
- a bug fix revealed missing seams or poor test surface
- user asks for refactor/architecture opportunities

Do not use for:

- local readability cleanup (`simplify`)
- immediate bug fix before diagnosis
- speculative rewrite without evidence

## Process

### 1. Load Context

Read:

- `CONTEXT.md` / `CONTEXT-MAP.md`
- relevant ADRs
- codemap if available
- affected code/tests
- `LANGUAGE.md`
- `INTERFACE-DESIGN.md` when proposing seams/interfaces

### 1.5 Scope the Scan (YAGNI)

Deepening a module pays off only when that area is likely to change again. Decide where to look before scanning broadly:

- If the user named a subsystem, module, pain point, or recent change, start there.
- Otherwise inspect a meaningful stretch of `git log --oneline --name-only` and identify recurring hot spots.
- Prefer candidates in actively changing paths over theoretical cleanup in cold code.
- If history is scattered and no useful hot spot appears, widen the scan and state that limitation.

Do not turn an architecture review into a repository-wide rewrite hunt. The goal is the smallest high-leverage deepening opportunity supported by change history and current friction.

### 2. Explore Friction

Look for:

- understanding one concept requires bouncing across many files
- module interface is nearly as complex as implementation
- pure helpers extracted only for testability but real behavior remains hard to test
- seams with only one adapter and no real variation
- domain rules duplicated in multiple places
- high coupling across unrelated areas
- tests forced to mock internal collaborators or inspect internals

Apply deletion test:

```text
If deleting this module removes complexity, it was pass-through.
If deleting it spreads complexity across callers, it was earning its keep.
```

### 2.5 Dependency and Seam Check

When a candidate involves a seam or dependency, classify it:

| Dependency type | Test/deepening strategy |
|---|---|
| In-process pure/local logic | merge/deepen behind one interface; test directly through that interface |
| Local-substitutable I/O | use local test stand-in; keep seam internal unless callers need it |
| Remote but owned service | define a port at the seam; production adapter + test adapter |
| True external service | inject external dependency; mock/stub only that boundary |

Rules:

- One adapter often means a hypothetical seam; two adapters usually means a real seam.
- Do not expose internal seams through the public interface just because tests need them.
- The interface is the test surface.
- Old tests on shallow modules should be deleted or replaced once deeper-interface tests cover the behavior.

### 3. Present Candidates

For each candidate:

```markdown
## Candidate: [name]

Files:
- [paths]

Problem:
- [why current architecture causes friction]

Proposed deepening:
- [plain English change]

Interface / seam shape:
- [small interface, dependency category, adapters if any]

Benefits:
- Leverage:
- Locality:
- Testability:

Risks:
- [migration/API/behavior concerns]

ADR conflicts:
- [none or specific ADR worth reopening]
```

### 4. Ask User to Choose

Do not design or implement all candidates. Ask which candidate to explore.

Then use `grill-with-docs` or `brainstorming` to turn the chosen candidate into a design.

If the user rejects a candidate for a durable/load-bearing reason, offer to record an ADR so future architecture reviews do not re-suggest it.
