# Vertical Slices

A vertical slice delivers one narrow behavior through the necessary integration layers.

## Prefer

- one behavior end-to-end
- demoable or verifiable independently
- minimal but real path through the system
- test first through public/project-standard interface
- tracer bullets that expose integration risk early

## Slice Acceptance Criteria

A valid slice:

- proves one behavior end-to-end
- has one primary RED test
- includes only the implementation needed for that behavior
- can be verified independently
- does not create orphaned infrastructure with no behavior
- leaves the system in a runnable state after the slice

## Avoid Horizontal Slices

Bad:

- all database changes
- all API endpoints
- all UI components
- all tests before implementation
- wire UI later

Why bad:

- no runnable feedback until late
- tests are based on imagined behavior
- integration risk is delayed
- agent may create mismatched layers
- review cannot validate behavior per step

## Tracer Bullet

The first task should often be a tracer bullet:

- one happy path
- intentionally narrow
- proves test setup, routing, persistence, API, or UI path
- exposes integration problems early

A tracer bullet is not a throwaway spike. It is production-shaped, narrow, and verified.
