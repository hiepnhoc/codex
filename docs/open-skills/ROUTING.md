# Codex Skill Routing

Start with one primary workflow. Add only overlays whose trigger is present.

## Priority rules

1. Explicitly named skill or workflow wins.
2. Unknown failure wins over feature/refactor routing: start with `diagnose`.
3. Product ambiguity is resolved before implementation.
4. Protected external or destructive actions always require approval.
5. Repository instructions and native validation commands override generic
   examples in this pack.

## Primary routes

| Request | Primary skill | Common follow-up |
|---|---|---|
| Everyday coding or mixed work | `daily-dev` | Narrow specialist route |
| Bug, regression, flaky test, unexplained slowness | `diagnose` | `tdd`, performance overlay |
| Non-trivial feature or behavior change | `brainstorming` | `writing-plans`, `executing-plans` |
| Existing design without implementation plan | `writing-plans` | `executing-plans` |
| Existing implementation plan | `executing-plans` | `subagent-driven-development` when supported |
| Explicit autonomous delivery | `yolo` | Internally selects the right route |
| Architecture/refactor | `improve-codebase-architecture` | `brainstorming`, ADRs |
| Unfamiliar repository | `codemap` | `domain-context`, `zoom-out` |
| Large unresolved effort | `zoom-out` | Research, prototype, or grilling |
| Current library/framework facts | `source-driven-development` | `deep-research` |
| Throwaway experiment | `prototype` | Record decision evidence |
| PRD, issues, triage | `to-prd`, `to-issues`, `triage` | Local drafts before publication |
| Review changes/commit/range | `ocr-code-review` | Relevant discipline overlays |
| Create or adapt skills | `writing-skills` | `write-a-skill` for small standalone work |

## Discipline overlays

- `api-and-interface-design`: public contracts, schemas, adapters, boundaries.
- `frontend-ui-engineering`: user-facing UI, responsive behavior, accessibility.
- `browser-testing-with-devtools`: live DOM, console, network, visual evidence.
- `security-and-hardening`: auth, secrets, untrusted input, storage, execution.
- `performance-optimization`: measured performance work only.
- `observability-and-instrumentation`: logs, metrics, traces, alerts, runbooks.
- `ci-cd-and-automation`: build, test, release, deployment automation.
- `documentation-and-adrs`: durable decisions and migration rationale.
- `doubt-driven-development`: adversarial review for high-impact decisions.
- `verification-planning`: non-trivial work needing an explicit evidence path.

## Runtime adaptation

- Global skills live under `${CODEX_HOME:-~/.codex}/skills/`.
- Repository skills live under `.agents/skills/`.
- When delegation is available, use fresh workers with explicit ownership. If it
  is unavailable, preserve the review gates in the current session.
- “Search” means the best available official-source browsing or retrieval
  capability. Never invent current facts when it is unavailable.
- Product-specific skills such as `oh-my-opencode-slim` and
  `release-smoke-test` intentionally retain OpenCode commands because OpenCode
  is the system under test, not the host runtime.

## Stop conditions

Stop and ask or report a blocker when required context cannot be obtained,
verification has no credible substitute, local customizations would be
overwritten without backup, or an action crosses an approval boundary.
