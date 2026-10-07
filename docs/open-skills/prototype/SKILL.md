---
name: prototype
description: Use when a design question needs throwaway code - builds a small runnable UI or logic prototype to learn before committing to production implementation.
---

# Prototype

## Purpose

A prototype is throwaway code that answers a question.

The question decides the shape.

## When to Use

Use when user wants to:

- sanity-check a data model
- test a state machine
- try several UI designs
- explore interaction flow
- answer "does this feel right?" before real implementation

Do not use when:

- production implementation is already clear
- prototype would require production data or irreversible actions
- there is no specific question to answer

## Choose Branch

| Question | Prototype type |
|---|---|
| Does this logic/state model work? | small runnable CLI/terminal harness |
| What should this look/feel like? | multiple UI variants in a throwaway route/component |

If ambiguous and user is reachable, ask. If not, choose based on affected code and state the assumption.

## Rules

1. Mark prototype clearly as throwaway.
2. Use `using-git-worktrees` before creating prototype files inside the repository unless the prototype lives outside the repo in a disposable temp directory.
3. Put it near relevant code when useful, but name it so it is not mistaken for production.
4. One command to run.
5. No persistence by default; never use production data.
6. Skip polish: no broad tests, no abstractions beyond runnability.
7. Surface internal state after each action/variant.
8. Remove prototype code from the production path after the question is answered. If the artifact itself is valuable as primary-source evidence, keep it only in an isolated worktree/throwaway branch or an external artifact location, and link it from the handoff/issue. Do not commit or publish it without user approval.

## UI Prototype Pattern

Prefer variants in the real surrounding page when possible, not an empty vacuum:

- Default: existing route/page with variants selected by `?variant=`.
- Last resort: new clearly named throwaway prototype route.
- Default to 3 radically different variants; cap at 5.
- Variants should differ in structure/information hierarchy, not just colors/copy.
- Keep existing data fetching/auth/params; swap only the rendering subtree.
- Add a visible dev-only switcher; hide it in production builds.
- Do not wire prototype variants to real mutations; stub mutations unless persistence is the question.

After selection, delete losing variants and the switcher. Do not promote prototype code directly to production without normal design/planning/testing.

## Logic Prototype Pattern

Use when the question is about state, data shape, or business rules.

- State the question in a README/comment.
- Use the host project's runtime/tooling; do not add a new package manager.
- Put reusable logic behind a small pure interface: reducer, state machine, pure functions, or minimal module.
- Keep terminal/UI shell separate from the logic.
- Use in-memory state by default.
- Re-render a small full frame after each action; show current state and available keys/actions.

The shell is throwaway. If useful, the validated logic shape can be absorbed into production via the normal plan.

## Handoff

```markdown
Prototype question:
How to run:
Variant/branch chosen:
What we learned:
Decision recommended:
Production disposition: delete / absorb validated decision
Prototype evidence: removed / retained at [isolated path or branch]
```
