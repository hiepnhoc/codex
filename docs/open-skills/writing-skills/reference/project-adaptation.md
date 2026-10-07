# Project Skill Adaptation

## Purpose

Use this when creating or updating `.agents/skills/` for a specific repository.

Goal: make the agent behave like a good engineer in this project, not a generic tutorial reader.

## Audit Sources

Start read-only. Check these before writing skills:

- `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`
- `README.md`, onboarding docs, architecture docs
- `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`
- existing `.agents/skills/` or other skill directories
- `package.json`, `pnpm-workspace.yaml`, `Makefile`, `Taskfile`, `justfile`
- `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, or equivalent stack files
- CI config: `.github/workflows/`, build scripts, lint/test commands
- test fixtures, e2e setup, local dev scripts, database migration docs
- repeated user corrections or prior agent failures if available

Do not read secrets or production credentials. Do not copy private data into skills.

## Decide Whether a Project Skill Is Needed

Create or update a project skill when at least one is true:

- agents repeatedly miss or misuse a project convention
- the workflow is risky, destructive, or hard to recover from
- commands are non-obvious or must run in a specific order
- domain vocabulary affects names, tests, or architecture
- an API/schema/generated-client rule is easy to get wrong
- a feedback loop or fixture setup is expensive to rediscover

Do not create a skill for a fact that belongs in `README`, `CONTEXT.md`, an ADR, or ordinary code comments.

## Project Skill Plan

Use `../templates/project-pack-plan.md` from this skill directory and fill:

- base skills to install unchanged
- base skills to update for this project
- project overlay skills to create
- skills to drop or not install
- evidence and verification required

## Common Project Overlay Skills

### `{project}-testing`

Include:

- one-command local test/lint/typecheck commands
- setup for databases, services, fixtures, or env vars
- fast vs full verification commands
- common flaky tests and allowed mitigation
- how to add regression tests at the right seam

### `{project}-architecture`

Include:

- canonical module names and domain vocabulary
- approved seams, adapters, and module boundaries
- ADRs that must not be re-litigated
- forbidden dependency directions
- examples of deep vs shallow modules in this repo

### `{project}-api`

Include:

- generated client workflow
- auth/session rules
- schemas and error shapes
- idempotency, retries, pagination, rate limits
- test fixtures and mock server commands

### `{project}-db-migrations`

Include:

- migration command sequence
- local verification and rollback rules
- data safety constraints
- generated file policy
- production approval boundaries

### `{project}-deploy` or `{project}-release`

Include:

- preflight checks
- changelog/version/build artifacts
- staging verification
- exact approval gates
- rollback handoff

## Adaptation Workflow

1. **Read project sources.** Build a short evidence table: source → relevant rule.
2. **Map failure risk.** List where a generic agent is likely to make a wrong assumption.
3. **Choose skill shape.** Reference for facts, procedure for ordered risky workflows, discipline for shortcuts, guidance for judgment.
4. **Write contract.** Use `../templates/skill-contract.md` before SKILL.md.
5. **Test baseline if behavior-changing.** Run no-skill/current-skill RED workers when practical.
6. **Package minimal guidance.** Put long details in `reference/` or `templates/`.
7. **Run GREEN.** A fresh worker should use the project skill to perform a representative task.
8. **Handoff.** State installed path, evidence, verification, and limits.

## What to Encode vs Leave Out

Encode:

- stable commands and expected outputs
- stable project vocabulary
- stable safety gates
- stable paths and generated-code rules
- verified examples that prevent mistakes

Leave out:

- secrets, tokens, credentials, private customer data
- temporary incident details unless generalized
- stale implementation trivia
- huge copied docs the agent should open only when needed
- preferences that conflict with existing repo instructions

## Project Fit Review

Before handoff, ask:

- Would this skill help a fresh agent on this project next week?
- Does it reference current commands and paths?
- Does it explain why the project is different from generic advice?
- Does it avoid repeating the base pack?
- Does it define verification, not just guidance?
- Can it be removed or updated without breaking other skills?
