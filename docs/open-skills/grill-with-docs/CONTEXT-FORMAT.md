# CONTEXT.md Format

Use this format for durable domain language.

```markdown
# Context

## Purpose

[What this product/domain area does in 2-4 sentences.]

## Domain Terms

### [Canonical Term]

Definition: [domain expert meaning]

Use when: [where this term applies]

Do not confuse with: [nearby/overloaded terms]

Example: [short concrete scenario]

## Workflows

### [Workflow Name]

1. [step]
2. [step]
3. [step]

## Invariants

- [Business rule that must always hold]

## Open Questions

- [Unresolved ambiguity]
```

Rules:

- Prefer domain meaning over implementation details.
- Keep it concise.
- Update as decisions crystallize.
- If a term is controversial, record the chosen canonical term and the rejected alternatives.
