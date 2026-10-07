# Skill Review Checklist

Use this before shipping a new or updated skill.

## Metadata

- [ ] Folder name matches `name`.
- [ ] `name` is lowercase kebab-case and under 64 characters.
- [ ] `description` starts with `Use when`.
- [ ] Description contains concrete triggers, symptoms, files, commands, or user phrases.
- [ ] Description states the behavior/capability.
- [ ] Description avoids first person and vague marketing words.
- [ ] Description does not conflict with another installed skill.

## Scope and Type

- [ ] Skill type is clear: reference, procedure, discipline, guidance, or router.
- [ ] Structure matches the type.
- [ ] `When to Use` and, when useful, `When Not to Use` are clear.
- [ ] Skill does not duplicate another base skill.
- [ ] Project-specific content is only present when the skill is a project overlay.

## Project Fit

- [ ] Stable project commands and paths were verified from the repo.
- [ ] Domain terms match `CONTEXT.md` or existing docs.
- [ ] ADRs and existing repo instructions were respected.
- [ ] No secrets, credentials, customer data, or temporary session notes are included.
- [ ] The skill explains why this project differs from generic advice.
- [ ] The skill has a verification path using project-native checks.

## Content Quality

- [ ] `SKILL.md` is an entry point, not an encyclopedia.
- [ ] Rules are specific enough to change behavior.
- [ ] Each non-obvious rule has a purpose or verification signal.
- [ ] Examples are concrete and not stale implementation trivia.
- [ ] No repeated rule appears in multiple sections.
- [ ] Failure paths and stop conditions are explicit.
- [ ] Handoff format includes verification results.

## Progressive Disclosure

- [ ] Long details live in `reference/`, `templates/`, or `scripts/`.
- [ ] Every important reference/template/script is linked from `SKILL.md`.
- [ ] Links are one level deep and paths exist.
- [ ] Long reference files have clear headings or contents.
- [ ] Template names describe the artifact they create.

## Discipline and Safety

- [ ] Behavior-changing guidance was based on RED evidence, prior incidents, or explicit user rules.
- [ ] Discipline skills include explicit negations, rationalization defenses, red flags, and recovery.
- [ ] Risky procedure skills use plan → validate → execute → verify.
- [ ] Destructive or external actions require explicit user approval.
- [ ] The skill never tells the agent to auto-merge, push, deploy, delete production data, or publish external tickets without approval.

## Empirical Verification

- [ ] RED/current-skill baseline ran when needed, or the handoff explains why not.
- [ ] RED/GREEN workers were fresh and isolated.
- [ ] Artifact reports exist under the skill directory or are captured in the handoff.
- [ ] GREEN avoided the important RED failures.
- [ ] GREEN completed the task correctly, not merely followed ritual.
- [ ] Verification used the target model/agent when practical.
- [ ] If no GREEN ran, final status is `UNVERIFIED`.

## Style

- [ ] Active voice.
- [ ] Direct commands.
- [ ] Minimal filler.
- [ ] One sentence, one idea.
- [ ] Consistent terminology.
- [ ] Emphasis is limited to true non-negotiables.
