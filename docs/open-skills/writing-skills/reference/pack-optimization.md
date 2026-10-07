# Codex Skill Pack Optimization

## Purpose

Use this when deciding what belongs in the daily Codex coding skill pack, what should be merged, and what should be dropped.

The optimized pack should be small enough to stay usable, but strong enough to prevent common agent engineering failures.

## Core Decision

Use `docs/my-skill/my-skill/current/` as the active optimized deliverable pack. Before modifying it, run the parent `scripts/new-version.sh` so the previous dated snapshot remains a backup.

It combines:

- the older empirical skill-development discipline: RED/GREEN, isolated workers, four-layer defenses, artifacts, no auto-merge
- Matt Pocock's engineering fundamentals: domain language, grilling, TDD vertical slices, diagnosis feedback loops, architecture depth, prototypes, concise skills

Do not install every source skill unchanged. That creates duplicated triggers, giant context, and conflicting workflows.

## Keep as Core

| Skill | Why keep |
| --- | --- |
| `daily-dev` | Router for everyday coding requests. Keeps the pack composable. |
| `domain-context` | Shared language reduces verbosity and naming drift. |
| `grill-with-docs` | Prevents misalignment before design or implementation. |
| `diagnose` | Forces feedback loop before debugging. |
| `deep-research` | Stops high-risk technical choices from vibes. |
| `brainstorming` | Turns evidence into a decision-backed design. |
| `writing-plans` | Converts design into vertical-slice TDD implementation tasks. |
| `using-git-worktrees` | Protects main workspace before non-trivial writes. |
| `executing-plans` | Single-context plan execution with verification. |
| `subagent-driven-development` | Fresh workers for independent implementation/review tasks. |
| `simplify` | Behavior-preserving cleanup after functionality works. |
| `improve-codebase-architecture` | Finds deepening opportunities, seams, locality, leverage. |
| `codemap` | Maps unfamiliar repos before serious work. |
| `prototype` | Answers design questions with throwaway code. |
| `to-issues` | Splits large plans into independently grabbable vertical slices. |
| `writing-skills` | Skill factory for project-specific adaptation. |
| `yolo` | Optional autonomous mode, guarded by intake, worktree, and verification. |

## Merge, Do Not Duplicate

| Source idea | Merge into | Reason |
| --- | --- | --- |
| Matt `write-a-skill` | `writing-skills` | Keep concise structure, progressive disclosure, scripts/reference guidance. |
| Old giant `writing-skills` | `writing-skills` + references | Preserve empirical testing and safety, but not as a 1000+ line entry skill. |
| Matt `grill-me` | `grill-with-docs` | Prefer domain/doc-aware grilling for engineering work. |
| Matt `tdd` | `writing-plans` + `executing-plans` | Keep vertical slices, behavior tests, public interface testing. Avoid duplicate TDD router. |
| Matt `diagnose` | `diagnose` | Keep almost directly; feedback-loop discipline is essential. |
| Matt `improve-codebase-architecture` | `improve-codebase-architecture` | Keep language of deep modules, seams, locality, leverage. |
| Matt deprecated `ubiquitous-language` | `domain-context` | Domain language is a project context concern. |
| Deprecated `qa` | `diagnose` + `executing-plans` | Quality should be feedback loops and verification gates, not separate vague QA. |
| Deprecated `design-an-interface` | `brainstorming` + `improve-codebase-architecture` | Interface design belongs inside design/architecture workflow. |

## Drop by Default

Do not include these in the daily pack unless a project specifically needs them:

- personal/non-coding skills such as article editing or Obsidian vault workflows
- exercise scaffolding or course-specific generators
- migration helpers for one library/tool unless that project uses the library
- Runtime-specific hooks that Codex cannot execute
- deprecated skills whose behavior is already absorbed into the core pack
- duplicate tiny skills whose triggers overlap heavily with `daily-dev`

## Update for Codex

When importing skills from another runtime:

1. Convert platform-specific tool names into capability language.
2. Target `.agents/skills/{skill-name}/SKILL.md` for repository skills or `${CODEX_HOME:-~/.codex}/skills/{skill-name}/SKILL.md` for global skills unless the user asks otherwise.
3. Replace "Claude" assumptions with "agent" or "worker" unless model-specific behavior matters.
4. Keep exact commands only when they are project-native and verified.
5. Keep subagent language generic: worker, task, dispatch job, forked session, separate CLI run, or fresh chat.
6. Link references/templates one level deep.
7. Mark unverified imports until a fresh worker uses them successfully.

## Minimal vs Full Install

### Minimal daily install

Use for small projects or low context overhead:

```text
daily-dev
domain-context
grill-with-docs
diagnose
writing-plans
using-git-worktrees
executing-plans
simplify
writing-skills
```

### Full engineering install

Use for serious product codebases:

```text
daily-dev
domain-context
grill-with-docs
diagnose
deep-research
brainstorming
writing-plans
using-git-worktrees
executing-plans
subagent-driven-development
simplify
improve-codebase-architecture
codemap
prototype
to-issues
writing-skills
yolo
```

### Project overlay skills

Create these only when the project has repeated rules worth encoding:

| Candidate | Use when |
| --- | --- |
| `{project}-testing` | Test commands, fixtures, database setup, e2e quirks are project-specific. |
| `{project}-architecture` | Module boundaries, ADRs, seams, or dependency rules are important. |
| `{project}-api` | Internal APIs, generated clients, schemas, or auth rules are easy to misuse. |
| `{project}-db-migrations` | Migrations are risky or have strict ordering/rollback rules. |
| `{project}-deploy` | Deployment/release has a fixed validation workflow. |
| `{project}-review` | PR/review style, acceptance criteria, or quality gates are specific. |
| `{project}-debugging` | Repro harnesses or logs are project-specific. |

## Final Optimization Rule

Keep the base pack general. Put project facts in project overlay skills. If a rule is universal, improve the base skill. If a rule is local, write a project skill.
