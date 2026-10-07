---
name: daily-dev
description: Use when handling software engineering requests as the default first router, especially multi-domain or multi-phase work; classify the task, select domain specialists, preserve their gates, and optionally hand heavy execution to `deepwork` after routing.
---

# Daily Dev

## Purpose

Route everyday software work into the smallest workflow that can complete it safely and correctly.

Do not load the whole pack. Pick one primary workflow, then add only overlays whose trigger is actually present.

## Start-of-Run Contract

Before acting, classify the request and announce the route briefly:

```text
Daily-dev route:
- Classification: [feature/bug/refactor/API/UI/etc.]
- Primary skill: [skill]
- Overlays: [only triggered overlays]
- Workspace: [read-only / existing isolated workspace / worktree before writes]
- Approval gate: [none / design approval / protected action approval]
- First action: [what happens now]
```

## Classification First

| Request shape | Primary route | Common overlays |
|---|---|---|
| Bug, failing test, regression, flaky behavior | `diagnose` → `tdd` when a regression seam exists | `browser-testing-with-devtools`, `performance-optimization` |
| Review workspace changes, a commit, or a branch range | `ocr-code-review` | relevant API/UI/security/performance overlays for finding validation |
| Measured or suspected slowness | `diagnose` → `performance-optimization` | browser/runtime profiling, `observability-and-instrumentation` |
| Non-trivial feature or behavior change | `domain-context` if domain meaning matters → `grill-with-docs` if ambiguous → `brainstorming` | API/UI/security/source overlays as applicable |
| Tiny mechanical edit with clear acceptance criteria | direct edit after repository inspection | project-native verification; no ceremonial design |
| API, SDK, schema, adapter, module/public boundary | `api-and-interface-design` | `source-driven-development`, `security-and-hardening`, `documentation-and-adrs` |
| User-facing page, component, dashboard, interaction | `frontend-ui-engineering` | `huashu-design` for visual exploration, `browser-testing-with-devtools`, accessibility/performance checks |
| Authentication, authorization, secrets, untrusted input, storage, external calls | `security-and-hardening` | `api-and-interface-design`, `tdd`, `doubt-driven-development` |
| Logs, metrics, traces, alerts, production diagnosis | `observability-and-instrumentation` | `documentation-and-adrs` |
| CI, build, release, deploy automation | `ci-cd-and-automation` | `security-and-hardening`, `observability-and-instrumentation` |
| Framework/library/API facts may be stale | `source-driven-development` | `deep-research` when alternatives/tradeoffs are needed |
| Technical approach is unclear, novel, or high-risk | `deep-research` | `source-driven-development`, `doubt-driven-development` |
| High-impact or overconfident decision needs adversarial review | `doubt-driven-development` | relevant domain skill |
| Design/PRD exists but no implementation plan | `writing-plans` | relevant API/UI/security overlays |
| Concrete implementation plan exists | `executing-plans` | `subagent-driven-development` for independent tasks |
| Heavy multi-phase session needs persistent progress/orchestration | `daily-dev` first, then optional `deepwork` execution coordinator | specialist route and gates remain authoritative |
| Effort is too large or uncertain for one session and the path is still foggy | `zoom-out` decision-map mode | `deep-research`, `prototype`, or `grill-with-docs` per open decision |
| Explicit test-first request or behavior slice | `tdd` | `diagnose` first for unknown failures |
| Architecture is tangled or hard to test/change | `improve-codebase-architecture` | `brainstorming`, `documentation-and-adrs` |
| Throwaway UI/logic exploration | `prototype` | `huashu-design` when visual fidelity matters |
| PRD from current context | `to-prd` | local draft by default; external publish requires approval |
| Implementation tickets/issues | `to-issues` | local drafts by default; external publish requires approval |
| Incoming issue workflow | `triage` | configured tracker rules |
| Unfamiliar repository | `codemap` → `domain-context` | `zoom-out` |
| Working behavior is heavier than necessary | `simplify` | rerun original verification |
| Durable decision/docs are required | `documentation-and-adrs` | relevant primary workflow |
| Context transfer to another agent/session | `handoff` | none |
| User explicitly wants autonomous delivery | `yolo` | `yolo` selects the internal route |
| Creating or improving reusable skills | `writing-skills` | `write-a-skill` only for a lightweight one-file checklist |

## Mandatory Rules

1. **Use the narrowest route.** More loaded skills do not mean better work.
2. **No vague build.** Resolve product/domain ambiguity before non-trivial design or implementation.
3. **No fixing without signal.** Reproduce, measure, or create a tight feedback loop before changing a bug.
4. **No big technical choices from memory or vibes.** Inspect official sources and alternatives when facts may be stale or risk is meaningful.
5. **No non-trivial repository writes in the main workspace.** Use `using-git-worktrees` unless already in an approved isolated workspace.
6. **No implementation before design approval for interactive non-trivial feature work.** `brainstorming` owns this gate. `yolo` may continue after its intake gate when no protected decision remains.
7. **No plan blind-following.** Validate plan assumptions and current-state claims against the codebase.
8. **No behavior change without an appropriate test strategy.** Prefer a regression/behavior test at the highest stable seam; explain when no useful seam exists.
9. **No completion without evidence.** Run project-native tests/build/typecheck/lint/runtime/browser checks, or report the exact blocker.
10. **No protected external action without explicit approval.** This includes merge, push, deploy, production/data deletion, external ticket publication, account changes, paid actions, and credential/security decisions.
11. **Review-only means read-only.** Use `ocr-code-review` delegation mode for code-review requests; do not fix findings unless the user explicitly requests review-and-fix, and never silently switch to OCR-managed LLM review.

## Specialist Gates Win

Routing never weakens a specialist's approval, stop, capability, or verification conditions. A broad request such as “build the feature” is not approval for a specific protected action.

Preserve at least these gates:

- security/privacy/auth/permission/CORS/upload/rate-limit decisions that the security workflow marks for human approval
- interface and behavior approval required by interactive TDD/design workflows, unless explicit `yolo` intake grants an equivalent autonomous boundary
- authorization before invoking an external model/CLI or mutating a browser/external system
- approval before tracker publication, deploy, merge, push, production migration, secret/branch-protection changes, or account mutation
- setup/configuration confirmation before writing repo-level agent instructions
- baseline-failure stop conditions from `using-git-worktrees`, including inside `yolo`

## Capability and Setup Preflight

- If a browser/MCP/reviewer/subagent capability is unavailable, use the documented fallback and report degraded verification; do not claim the unavailable check passed.
- If a Matt-style route needs `docs/agents/` issue/domain configuration and it is absent, tell the user to run `/setup-matt-pocock-skills` or continue read-only with the limitation stated. Do not pretend the disabled setup skill auto-loaded.
- `subagent-driven-development` requires an implementation plan and independent, non-overlapping tasks. For coupled high-risk work, prefer `executing-plans` plus `doubt-driven-development` or explicit review checkpoints.
- If optional `deepwork` is installed, use it only after `daily-dev` has classified the work and selected specialist workflows. `deepwork` coordinates progress/delegation; it does not replace domain design, approval, isolation, or verification gates.

## Domain Verification Matrix

Project-native tests are necessary but not always sufficient:

- browser/UI: render the changed flow in a real browser; inspect console/network, keyboard, responsive behavior, and accessibility as applicable
- performance: report comparable before/after measurements, environment, and variance
- security-sensitive: run negative/abuse/authorization checks and the relevant security checklist
- telemetry: inspect emitted logs/metrics/traces or a realistic capture, not code review alone
- API/public contract: verify schema/error behavior, compatibility, and consumer impact
- CI/CD: validate configuration syntax and dry-run/sandbox behavior; protected deployment mutations remain approval-gated
- code review: preview the exact target first, resolve OCR rules, validate every finding against repository context, and run project-native verification separately

## Workspace Write Policy

Read-only discovery may happen in the current workspace.

Before non-trivial repository writes, create or switch to an isolated worktree/workspace. Writes include:

- code, tests, fixtures, generated files, migrations
- `CONTEXT.md`, ADRs, and durable documentation
- design/research/plan artifacts saved in the repository
- repo-local prototypes and issue drafts

Default worktree location:

```text
<repo-root>/.worktrees/<safe-branch-name>
```

Ensure `.worktrees/` is gitignored. If the current workspace is already an approved worktree, reuse it rather than nesting another one.

Before choosing repo-local `.worktrees/`, run `git check-ignore -q .worktrees/`. If it is not ignored, do not silently edit tracked `.gitignore`; ask for the tiny bootstrap edit, use `.git/info/exclude` while disclosing the local-only change, or choose an external isolated worktree.

Exceptions:

- read-only analysis: no worktree
- disposable experiment outside the repository: use a temp directory
- tiny edit explicitly requested on the current branch: state the exception before writing. “Tiny” means one narrowly scoped file, no behavior/API/schema/dependency/migration/generated-output change, and immediate project verification; otherwise isolate it.

## Core Recipes

### Non-Trivial Feature

```text
read-only repo/domain scan
→ grill-with-docs only for unresolved product decisions
→ source-driven-development/deep-research only when triggered
→ API/UI/security overlays only when triggered
→ brainstorming and interactive design approval
→ using-git-worktrees before saving repo artifacts or editing
→ writing-plans
→ executing-plans or subagent-driven-development
→ tdd per behavior slice
→ browser/security/perf/observability verification as applicable
→ simplify
→ documentation-and-adrs when the decision should persist
```

In `yolo`, replace ceremonial approval with the `yolo` intake/evaluation gates, but stop for protected or genuinely ambiguous product decisions.

### Bug / Regression

```text
diagnose in read-only or throwaway mode where possible
→ reproduce/minimize/measure
→ using-git-worktrees before persistent test/fix writes
→ regression test at a correct seam when useful
→ minimal fix
→ rerun the original feedback loop
→ broader project-native checks
→ simplify only if behavior remains unchanged
```

### Code Review

```text
ocr-code-review preview in delegation mode
→ confirm files, refs, exclusions, and untracked scope
→ resolve review rules
→ inspect exact diff plus only necessary repository context
→ verify line positions and concrete failure scenarios
→ report high-confidence findings first
→ fix only when explicitly requested
→ run project-native checks and re-review the resulting diff
```

### API / UI Change

```text
domain-context if terminology matters
→ api-and-interface-design and/or frontend-ui-engineering
→ source/security overlays when triggered
→ brainstorming for non-trivial behavior/design choices
→ worktree → writing-plans → tdd/execution
→ browser/runtime verification for UI
→ docs/ADR for durable public or architectural changes
```

### Refactor / Architecture

```text
improve-codebase-architecture
→ choose a concrete candidate and success signal
→ brainstorming if target structure or tradeoffs are non-trivial
→ worktree → writing-plans → execution
→ verify behavior and architecture goals
→ documentation-and-adrs when the decision should persist
```

### Production / Delivery

```text
ci-cd-and-automation
→ security-and-hardening
→ observability-and-instrumentation
→ rollback/runbook/docs
→ verify in the safest available environment
→ request explicit approval before deploy/publish/external mutation
```

## Execution Mode Selection

Use `executing-plans` when tasks are dependent, tightly coupled, or cheapest in one continuous context.

Use `subagent-driven-development` when tasks are independent, files do not overlap, and fresh-context implementation/review justifies the coordination cost.

Use `to-issues` instead of immediate execution when work is too large for one PR/session or should be picked up independently by humans/AFK agents.

Use `zoom-out` before `to-issues` when the destination is known but the decisions needed to reach it are not yet clear. `zoom-out` resolves decision tickets; `to-issues` decomposes an approved build path into implementation tickets.

Use direct execution only for small, clear, low-risk work that does not benefit from a design/plan ceremony. Direct does not mean unverified.

## Completion Report

```markdown
Daily-dev result:
- Route used:
- Workspace/worktree:
- What changed:
- Evidence run:
- Design/approval decisions:
- Risks or remaining gaps:
- Protected next actions needing approval:
```
