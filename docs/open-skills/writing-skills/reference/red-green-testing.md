# RED/GREEN Testing for Skills

## Purpose

Use RED/GREEN testing to prove a skill changes fresh-agent behavior.

A skill is production code. RED/GREEN reports are its tests.

## Isolation Contract

RED and GREEN workers must be independent from the parent conversation.

They must have:

- fresh context
- minimal prompt
- same or equivalent task spec
- isolated workspace/worktree when editing files
- explicit artifact path
- no parent analysis, expected failure list, or proposed solution

The parent may prepare prompts, create worktrees, read artifacts, compare results, and edit the skill. The parent may not count its own reasoning as RED or GREEN.

## Testing Depth

| Skill/change | Suggested RED | GREEN | Reviewer |
| --- | --- | --- | --- |
| Reference-only skill | 0-1 discovery attempt | 1 navigation/use attempt | optional |
| Procedure skill | 1 baseline attempt | 1 equivalent task | optional |
| Guidance skill | 1-2 baseline attempts | 1 equivalent task | useful |
| Discipline/guardrail skill | 2-3 baseline attempts | 1-2 shortcut-pressure attempts | recommended |
| Major update | 1 current-skill attempt | 1 revised-skill attempt | recommended |
| Minor wording/link fix | skip RED | 1 representative use if possible | optional |

Stop adding RED attempts when you have enough evidence. Do not run workers for ceremony.

When using multiple RED attempts, keep the task spec and starting state equivalent. Vary only the fresh worker/session. This makes differences in output evidence of ambiguity or missing guidance instead of prompt drift.

## Artifact Layout

Inside the skill directory:

```text
{skill-root}/
├── SKILL.md
├── reference/
├── templates/
└── tests/
    ├── red-attempt-1.md
    ├── red-attempt-2.md
    ├── red-analysis.md
    ├── green-attempt-1.md
    └── green-analysis.md
```

For project deliverables, `{skill-root}` usually means:

```text
.agents/skills/{skill-name}
```

## RED Prompt Shape

For a new skill:

```markdown
You are a fresh isolated worker. You have no skill loaded for this task.
Use only the task spec below. Do not rely on parent conversation context.

Task: {representative task}
Working directory: {isolated workspace/worktree if editing}

Complete the task fully. When done, write a report to:
{skill-root}/tests/red-attempt-1.md

Report:
- task spec received
- approach and decisions
- files changed or intentionally unchanged
- commands/checks run and results
- final output
- difficulties, shortcuts, assumptions, and missing context
```

For an update:

```markdown
Use the current skill `{skill-name}` plus this new requirement:
{new requirement}

You are a fresh isolated worker. Use only this prompt and the current skill.
Write the report to {skill-root}/tests/red-attempt-1.md.
```

## RED Analysis

Create `tests/red-analysis.md` after reading all RED reports.

Record:

- failures with quotes or concrete evidence
- strengths worth preserving
- wrong project assumptions
- skipped verification
- unsafe or irreversible actions attempted
- over-engineering or irrelevant best practices
- diverging approaches that reveal ambiguity
- failure modes the skill must address

If every baseline worker succeeds cleanly, reconsider whether a new skill is needed. You may only need documentation or a small reference file.

## GREEN Prompt Shape

```markdown
Use the revised skill `{skill-name}` to complete this task.
You are a fresh isolated worker. Do not rely on parent conversation context, RED analysis, or hidden expectations.

Task: {same or equivalent task as RED}
Working directory: {isolated workspace/worktree if editing}

Complete the task fully following the skill. Write a report to:
{skill-root}/tests/green-attempt-1.md

Report:
- task spec received
- how the skill changed your approach
- skill rules/principles applied
- files changed or intentionally unchanged
- commands/checks run and results
- final output
- any remaining uncertainty
```

## GREEN Analysis

Create `tests/green-analysis.md`.

Check:

1. Did GREEN avoid each RED failure?
2. Did GREEN complete the original task correctly?
3. Did the worker follow the skill, or succeed for unrelated reasons?
4. Did the worker verify its work?
5. Did isolation hold?

Pass only when the revised skill prevents the important RED failures and the task output is correct.

For major, risky, destructive, discipline, or multi-agent skills, ask an independent reviewer to read `red-analysis.md`, `green-attempt-*.md`, `green-analysis.md`, and `SKILL.md`. The reviewer should verify RED prevention, task correctness, isolation, and whether the worker followed the skill rather than succeeding for unrelated reasons.

## Failure Handling

If GREEN fails:

1. Quote the failure.
2. Identify the missing or weak instruction.
3. Add the smallest fix to `SKILL.md` or a reference file.
4. Rerun GREEN with a fresh worker.
5. Stop after two failed refinement rounds and hand off as `FAIL` with specific gaps.

If workers/tooling are unavailable:

- perform a structured review using `../reference/review-checklist.md` from this skill directory
- mark `Verification: UNVERIFIED`
- explain exactly what still needs a fresh-worker test

## Invalid Shortcuts

Do not accept:

- imagined pressure scenarios instead of baseline worker output
- GREEN performed by the same agent that wrote the skill
- GREEN prompt that contains the RED failure list
- reports saved outside the skill directory and never copied back
- UI-only evidence without a report artifact
- one worker reused for multiple attempts
- parent-context review presented as independent review
