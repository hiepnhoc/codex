# Codex Skill Pack Optimization

## Goal

Keep a high-signal Codex engineering pack without loading duplicated workflows
or encoding tool APIs that may not exist in every Codex surface.

## Composition

The pack combines:

- local routing, isolation, planning, execution, and verification workflows;
- Matt Pocock-derived domain, diagnosis, TDD, architecture, PRD, and issue
  workflows;
- Addy Osmani-derived API, frontend, browser, security, performance,
  observability, CI/CD, documentation, source, and doubt overlays;
- Alibaba OCR delegation for deterministic review scope and rule resolution.

## Routing Policy

1. Start with one primary workflow.
2. Add specialist overlays only when their trigger is present.
3. Prefer repository evidence over generic advice.
4. Keep research, design, planning, implementation, and verification gates
   distinct when the work is non-trivial.
5. Do not require delegation. Use fresh workers when Codex exposes them;
   otherwise preserve the review boundary in the current session and disclose
   the limitation.

## Codex Adaptation Rules

- Global skills target `${CODEX_HOME:-~/.codex}/skills/`.
- Repository skills target `.agents/skills/`.
- Repository workflow artifacts target `.agents/tasks/`.
- `SKILL.md` frontmatter uses only Codex-supported keys.
- Manual invocation policy lives in `agents/openai.yaml`.
- Named OpenCode workers are expressed as capabilities: focused research,
  independent review, design ownership, or bounded mechanical implementation.
- Current facts require available official-source browsing/retrieval; if it is
  unavailable, state the limitation rather than guessing.
- Product-specific OpenCode commands remain only where OpenCode is the system
  being inspected or tested.

## Context Discipline

- Keep `SKILL.md` focused on triggers, workflow, gates, and navigation.
- Put detailed variants in one-level-deep `references/` files.
- Prefer deterministic scripts for repetitive validation and packaging.
- Avoid overlapping top-level skills when one router plus an overlay is enough.
- Keep project facts out of this generic pack.

## Install Policy

Do not blindly replace `${CODEX_HOME:-~/.codex}/skills`.

The installer must:

- dry-run by default;
- validate before writing;
- back up managed destinations;
- update only pack-owned skill names;
- preserve `.system` and unrelated skills;
- support non-destructive and exact rollback modes.

## Verification Checklist

- Every first-level skill directory contains `SKILL.md`.
- Frontmatter has a folder-matching `name` and high-signal `description`.
- Frontmatter contains no unsupported keys.
- Skill names are unique and kebab-case.
- Relative links from skill entrypoints resolve.
- Manual-only skills have `agents/openai.yaml` policy.
- `manifest.json` exactly matches current entrypoint hashes and line counts.
- Installer dry-run succeeds against a temporary target.
- Install and exact rollback succeed against a temporary target while
  preserving `.system` and unrelated skills.
