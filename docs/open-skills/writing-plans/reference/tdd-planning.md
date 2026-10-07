# TDD Planning

## Core Rule

Plan test contracts before implementation, but execute vertically:

```text
one behavior → one RED test → minimum GREEN implementation → optional refactor → next behavior
```

Do **not** write all tests first and then all implementation. That is horizontal slicing.

Wrong:

```text
RED: test1, test2, test3, test4
GREEN: impl1, impl2, impl3, impl4
```

Right:

```text
RED/GREEN: test1 → impl1
RED/GREEN: test2 → impl2
RED/GREEN: test3 → impl3
```

## Good Tests

- verify behavior, not implementation
- exercise real code paths when practical
- use public or project-standard interfaces
- read like specifications
- survive internal refactors
- focus on critical paths and complex logic
- have one logical behavior/assertion target

## Bad Tests

- test private methods
- mock internal collaborators unnecessarily
- assert internal call counts/order
- assert internal data shape without observable behavior
- break when implementation changes but behavior remains
- verify by bypassing the interface, e.g. direct DB queries when a read API exists

## Test Inheritance

Extend existing test style before inventing a new one.

Before planning a new test file, harness, fixture, mock style, or naming pattern:

1. Find nearby tests for the same domain or interface.
2. Reuse their naming, setup, fixture, and assertion style when the seam is healthy.
3. Add cases to existing test files when that keeps behavior grouped and readable.
4. Create new test infrastructure only when the domain is new or existing harnesses cannot exercise the required behavior.

If the area has no reliable test seam, state that as a Testing Reality Gate and ask before adding broad infrastructure.

## Test Contract Requirements

The expected RED failure must prove missing behavior or contract. It must not be caused by wrong naming, wrong setup, unsupported harness, missing fixtures, or a test interface the project does not use. Research project test patterns before defining the contract.

Every planned test must include:

- behavior name
- public/project-standard interface used
- setup data
- action
- expected observable result
- expected RED failure reason
- targeted command to run it

Template:

```markdown
- Behavior:
- Interface:
- Setup:
- Action:
- Expected result:
- RED failure reason:
- Command:
```

## Mocking Rules

Mock only true system boundaries:

- external APIs/services
- time/randomness
- filesystem/network when necessary
- databases only when no test DB/in-memory harness exists

Do not mock:

- internal modules
- internal services
- own repositories/stores when real test infrastructure exists
- domain logic

If mocking an external boundary, prefer dependency injection and specific SDK-style functions over generic fetch/request mocks.

## Interface and Deep Module Notes

Tests should cross the same seam callers use.

Prefer interfaces that are easy to test because they are useful, not because internals were exposed for tests:

- small method/parameter surface
- dependencies accepted/injected rather than created internally
- observable results returned where practical
- implementation complexity hidden behind the interface

## Per-Slice Loop

1. RED: write one behavior test
2. confirm failure is for the expected reason
3. GREEN: implement minimum code
4. refactor only after GREEN
5. run targeted verification
6. move to the next behavior
