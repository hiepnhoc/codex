# Failure Handling

When implementation or review fails:

1. Read the failure carefully.
2. Classify:
   - test expectation wrong
   - implementation wrong
   - plan stale
   - codebase constraint
   - dependency/environment issue
3. Try a focused fix.
4. Rerun the smallest relevant verification.
5. If still failing after focused attempts, document and escalate if scope/behavior changes.

Safe-to-continue rule:

- Continue only when the remaining issue is isolated, non-critical, documented, and does not affect downstream tasks.
- Stop and ask when the issue affects shared contracts, public API behavior, migrations, security/privacy, data integrity, or any dependency for later tasks.
- Do not add TODO comments or known-issue docs as a way to bypass critical failures.

Do not hide failures. Do not mark task complete without evidence.
