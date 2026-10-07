# Reviewer Orchestration Patterns

## Main rule

The main-session orchestrator owns fresh-context review. A worker should not recursively dispatch another reviewer unless the runtime explicitly supports nested delegation and the workflow intentionally allows it.

## Preferred pattern

1. Producer returns only the artifact and verification contract.
2. Orchestrator dispatches a fresh reviewer without the producer’s conclusion or chain of reasoning.
3. Reviewer attempts to disprove compliance with the contract and returns concrete findings with evidence.
4. Producer or orchestrator fixes findings.
5. A new review pass verifies the revised artifact.

## Anti-patterns

- Asking the producer to “double-check” and calling it independent review.
- Passing the producer’s claim/conclusion to the reviewer and biasing the verdict.
- Workers recursively spawning workers without bounded ownership.
- Multiple reviewers editing overlapping files simultaneously.
- Reporting degraded self-review as fresh-context review.

## Capability fallback

If independent review is unavailable, disclose degraded mode, use a separate adversarial pass with a hard context separator, and preserve unresolved risk in the final report.
