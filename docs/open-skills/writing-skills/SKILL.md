---
name: writing-skills
description: Use when creating, updating, or adapting Codex skills for a project. Turns observed agent failures and project rules into lean SKILL.md resources, then verifies them with fresh workers when available.
---

# Writing Skills

## Purpose

Turn repeatable project knowledge into agent behavior.

A good skill is not a documentation dump. It is a small behavior package that helps a fresh agent make better decisions, avoid known shortcuts, and verify its work in this project.

Target new deliverable skills here unless the user names another runtime:

```text
.agents/skills/{skill-name}/SKILL.md
```

Use portable capability language: read files, search code, run commands, dispatch isolated workers. Avoid platform-specific tool names unless the skill targets that platform.

## Core Loop

```text
project audit → classify → isolate → baseline → observe → package → verify → review → handoff
```

Iron law:

```text
No behavior-changing skill without evidence from real or representative agent behavior.
```

If tooling cannot run fresh workers, state the limitation and mark the skill unverified. Do not pretend parent-context review is GREEN.

## When to Use

Use this skill when:

- creating a new skill
- updating an existing skill's behavior, triggers, or scope
- adapting a base skill pack to a specific project
- turning repeated project rules into `.agents/skills/`
- adding guardrails for risky engineering workflows
- importing external skills and deciding what to keep, merge, or drop

Do not use it for one-off notes, temporary TODOs, or generic best practices that do not change agent behavior.

## Required Output

Every completed skill change should produce:

- a target-behavior contract
- updated `SKILL.md` and any `reference/`, `templates/`, or `scripts/` files
- evidence used: RED/GREEN reports, review notes, or explicit unverified status
- a handoff that lists path, change type, verification, and known limits

Use `templates/skill-contract.md` before writing a new or majorly updated skill.

## Mode Selection

| Request | Mode | RED | GREEN |
| --- | --- | --- | --- |
| New behavior-changing skill | Full empirical | 1-3 no-skill baseline workers | 1 fresh skill-guided worker |
| Major update | Current-skill baseline | 1-2 workers using current skill + new requirement | 1 fresh worker with revised skill |
| Minor wording/link/reference edit | Lightweight | Usually skip | 1 representative GREEN when possible |
| Import external skill pack | Pack adaptation | Audit pack + sample baseline if behavior changes | Verify selected project workflow |
| Emergency draft requested by user | Draft | May skip only if user accepts draft mode | Mark unverified unless GREEN ran |

Use the smallest test depth that produces credible evidence. Risky discipline skills, destructive workflows, and multi-agent orchestration need more RED attempts than simple reference skills.

## Skill Types

Ask: **What should this skill teach?**

| Type | Teaches | Structure |
| --- | --- | --- |
| Reference | exact APIs, commands, schemas, docs | navigation, quick start, gotchas |
| Procedure | ordered workflow where skipped steps cause damage | inputs, steps, validation gates |
| Discipline | behavior to enforce or prevent | iron law, rationalizations, red flags, recovery |
| Guidance | judgment, design, planning, tradeoffs | principles, decision points, heuristics |
| Router | choosing other skills/workflows | classification table, routing rules, safety gates |

Do not force every skill into steps. Judgment skills need principles and decision points. Fragile operations need ordered gates.

## Project Adaptation Rules

Before writing project-specific skills, audit the project:

- existing `AGENTS.md`, `README`, `CONTEXT.md`, ADRs, and docs
- package scripts, test commands, CI, build/deploy commands
- existing `.agents/skills/` or other agent instructions
- domain vocabulary, module boundaries, architecture decisions
- repeated user corrections, failed agent attempts, and risky workflows

Create a project skill only when the rule is repeated, project-specific, risky, or expensive to rediscover. Otherwise update normal docs or context.

Project skills should contain exact project commands and paths, but never secrets, production credentials, private data dumps, or temporary session history.

Read `reference/project-adaptation.md` when building skills for a specific repository.

## Packaging Rules

### Frontmatter

The description is the discovery hook. It must say when to load the skill.

```yaml
---
name: kebab-case-name
description: Use when [trigger/symptom] - [what the skill makes the agent do]
---
```

Prefer concrete triggers: file types, commands, user phrases, failure symptoms, repo workflows, or agent rationalizations.

### SKILL.md

Keep `SKILL.md` as the entry point:

- purpose and trigger
- core principle or workflow
- non-negotiable rules
- decision points or validation gates
- links to reference/templates/scripts
- completion checklist or handoff format

Move long examples, prompts, checklists, and command catalogs to one-level files under `reference/` or `templates/`. Frequently loaded skills should stay roughly 100-250 lines when possible; avoid giant all-in-one skills.

### Files, scripts, and test artifacts

Keep reusable assets inside the skill directory:

```text
{skill-root}/
├── SKILL.md
├── reference/
├── templates/
├── scripts/
└── tests/
```

Do not create helper scripts, debug files, RED/GREEN reports, or temporary test artifacts in `/tmp`, `~`, or random repo folders. Put deterministic helpers under `scripts/` and empirical evidence under `tests/`. Scripts and templates must be generic: no secrets, private project names, production URLs, credentials, or session-specific data.

### Engineering ingredients to preserve

When relevant, encode these proven engineering rules:

- unclear product/domain meaning → align vocabulary and ask one decision at a time
- debugging → build a fast deterministic feedback loop before fixing
- feature work → use vertical slices and behavior tests through public interfaces
- planning → codebase evidence beats plan assumptions
- architecture → prefer deep modules, good seams, locality, and leverage
- prototypes → answer one question, run with one command, delete or absorb
- repository writes → use isolated worktrees/workspaces for non-trivial work
- completion → verify with project-native checks or report why unavailable
- irreversible actions → never merge, push, deploy, delete production data, or publish external tickets without explicit approval

Read `reference/skill-design-rules.md` for structure, description, progressive disclosure, discipline defenses, and style.

## Empirical Testing

RED/GREEN attempts must be fresh and isolated.

GREEN is mandatory for every behavior-changing skill change. For typo-only or formatting-only edits, run at least the review checklist and mark the handoff as `UNVERIFIED` if no fresh GREEN worker was used. Do not count the authoring agent's same-context judgment as GREEN.

Required evidence for each worker:

- task spec received by the worker
- skill mode: no-skill, current-skill, or revised-skill
- workspace/worktree path when files are edited
- actions taken and files changed
- commands/checks run and results
- final report path or captured output
- parent readback confirming the report exists and is usable

Invalid evidence:

- parent agent reasoning from the same context
- UI task row with no artifact
- imagined pressure scenarios with no worker output
- GREEN run that saw the RED analysis or proposed answer

Read `reference/red-green-testing.md` for prompts, artifact names, and pass criteria. Use `templates/red-green-report.md` for reports.

## Four-Layer Defense for Discipline Skills

When the skill must prevent shortcuts, close each loophole four ways:

1. explicit negation: `Do not [observed shortcut]`
2. rationalization defense: `If you think X, reality is Y`
3. red flags: `If you are about to X, stop and recover by Y`
4. trigger update: include the violation symptom in `description`

Use rationalizations observed in RED or prior failures. Do not invent a huge defense table for imaginary problems.

## Review Gate

Before handoff, verify:

- name matches folder and is lowercase kebab-case
- description starts with `Use when` and contains concrete triggers
- type and structure match the behavior being taught
- project-specific commands/paths are accurate and safe
- long details are linked from `SKILL.md`, one level deep
- scripts/templates live inside the skill directory
- known RED failures are addressed by the smallest useful guidance
- GREEN passed, or the handoff clearly says `UNVERIFIED`
- no irreversible action was performed without user approval

For major, risky, destructive, discipline, or multi-agent skills, use an independent reviewer when available to compare RED failures, revised skill text, and GREEN output. Do not count the authoring agent's same-context judgment as independent review.

Do not auto-merge skill work. Inspect changed files, report anything outside the intended skill directory, and hand off for user review unless the user explicitly requested a merge.

Read `reference/review-checklist.md` for the full checklist.

## Handoff

```markdown
Skill update complete:
- Path:
- Change type: new / major update / minor update / project adaptation / imported pack
- Skill type:
- Evidence used:
- Verification: PASS / FAIL / UNVERIFIED
- Files changed:
- Known limitations:
- Recommended next use:
```

## References

- Read `reference/pack-optimization.md` when curating the whole Codex skill pack or deciding what to keep/merge/drop.
- Read `reference/project-adaptation.md` when creating skills for a specific repository.
- Read `reference/red-green-testing.md` when running empirical RED/GREEN validation.
- Read `reference/skill-design-rules.md` when choosing structure, metadata, and progressive disclosure.
- Read `reference/review-checklist.md` before handoff.
- Use `templates/skill-contract.md`, `templates/skill-skeleton.md`, `templates/project-pack-plan.md`, and `templates/red-green-report.md` as starting artifacts.
