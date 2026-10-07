# Plan Review Checklist

Before handoff, verify:

- [ ] full source design/spec was read
- [ ] every section was inventoried for long/complex specs
- [ ] 100% of requirements are extracted
- [ ] every requirement maps to at least one task
- [ ] work classification is correct per scope area
- [ ] no task silently mixes old and new patterns without migration/removal strategy
- [ ] every current-state claim has code/doc evidence
- [ ] design/codebase discrepancies are classified and resolved
- [ ] pattern quality was assessed before reuse
- [ ] pattern evidence uses enough real examples, or states why evidence is sparse
- [ ] technical debt or critical baseline issues are explicit
- [ ] project-native commands are evidenced from config/docs
- [ ] plan is vertical-slice based, not horizontal layer based
- [ ] first task is a tracer bullet when feasible
- [ ] plan uses one ordered task graph, not arbitrary phase buckets
- [ ] every task has dependencies and review/checkpoint timing
- [ ] safe parallel/batch opportunities are explicit
- [ ] unsafe batching is avoided for shared contracts, public APIs, migrations, security, or overlapping files
- [ ] every task has RED test details and expected failure reason
- [ ] expected RED failures prove missing behavior/contract, not broken test setup or wrong naming
- [ ] new tests extend existing project harness/style unless a new harness is justified
- [ ] no horizontal RED-all-tests/GREEN-all-code plan
- [ ] tests use public/project-standard interfaces
- [ ] tests avoid unnecessary internal collaborator mocks
- [ ] implementation details are not exposed only for tests
- [ ] dead-code cleanup/migration is explicit
- [ ] old and new paths do not coexist without a removal plan
- [ ] high-risk / REFACTOR / MIXED / public API / migration plans had independent review when available
- [ ] execution recommendation explains executing-plans vs subagent-driven-development vs to-issues
- [ ] plan tells executor exactly where artifacts and worktree should live
