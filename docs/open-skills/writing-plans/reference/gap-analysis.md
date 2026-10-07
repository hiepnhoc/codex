# Gap Analysis

Compare target design to current codebase reality.

## Table

| Component | Current state | Target state | Gap | Evidence |
|---|---|---|---|---|

## Verification Table

Every current-state claim must have evidence.

| Claim | Evidence command/file | Finding | Match? |
|---|---|---|---|

If evidence is missing, the claim is not allowed in the plan.

Evidence can be:

- file path and symbol read
- search result with context
- test/config command from project files
- ADR/context doc reference
- runtime behavior from a reproducible local command

## Discrepancy Classification

| Type | Signal | Action |
|---|---|---|
| Intentional refactor | design explicitly proposes rename/replace/restructure | follow design |
| Design error | design assumes nonexistent current code casually | route back to design/brainstorming |
| Ambiguous | significant mismatch and intent unclear | ask user |

Classify carefully. A design that says "rename AuthService to AuthenticationService" is intentional. A design that casually says "AuthenticationService" while code only has `AuthService` is ambiguous.

When in doubt, ask. The cost of one question is lower than implementing the wrong plan.
