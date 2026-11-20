# Interface Design Notes

Good interfaces:

- expose domain behavior, not implementation steps
- hide ordering/config/invariant complexity
- make invalid states hard or impossible
- provide a natural test surface
- reduce caller knowledge
- concentrate behavior and decisions in one place

Warning signs:

- caller must know internal ordering
- many boolean flags
- interface mirrors database/internal structure exactly
- every caller repeats validation or orchestration
- test must reach into internals to verify behavior
- method surface grows whenever implementation changes
- seam has only one adapter and no real variation

When proposing a new seam:

1. name the domain concept behind the seam
2. list callers
3. classify dependency type: in-process, local-substitutable, remote-owned, true external
4. list adapters only if real variation exists
5. define behavior and invariants
6. show how tests become simpler
7. state what internals remain hidden

## Testability Rules

- Accept dependencies instead of creating them internally when the dependency is external or variable.
- Return observable results where practical; avoid hidden side effects as the only outcome.
- Test through the interface callers use.
- Do not expose internals solely for tests.
- Replace old shallow-module tests after deep-interface tests cover the behavior; do not layer duplicate brittle tests forever.
