---
name: codemap
description: Use when starting on an unfamiliar repository or when user asks for repository documentation - creates/updates hierarchical codemaps and registers the root map for future agents.
---

# Codemap

## Purpose

Create a repository atlas that helps agents and humans navigate unfamiliar code.

Codemap is expensive. Use it for unfamiliar repos, onboarding, architecture documentation, or before large work in poorly understood code.

## When to Use

Use when:

- user asks to map/understand a repo
- repo is unfamiliar and upcoming work is non-trivial
- existing codemap is missing/stale
- agents repeatedly waste time rediscovering structure

Do not use for tiny edits or familiar local changes.

## Workspace Guard

Checking existing maps and inspecting the repository may be read-only in the current workspace. Before running `init`/`update` commands or writing codemap/state/AGENTS files, switch to an approved isolated workspace/worktree unless the user explicitly requests a tiny current-branch documentation edit.

## Workflow

### 1. Check Existing State

Look for:

- `.slim/codemap.json`
- legacy `.slim/cartography.json`
- root `codemap.md`
- directory-level `codemap.md`

If state exists, prefer change detection over full remap.

### 2. Initialize or Detect Changes

Use the included script when available:

```bash
node <skill-dir>/scripts/codemap.mjs init --root ./ --include "src/**/*.ts" --exclude "**/*.test.ts" --exclude "dist/**" --exclude "node_modules/**"
node <skill-dir>/scripts/codemap.mjs changes --root ./
node <skill-dir>/scripts/codemap.mjs update --root ./
```

Adapt include/exclude patterns to the project. Respect `.gitignore`.

Map core source/config files, not every file. Exclude tests, generated output, vendored dependencies, bulky docs, translations, build artifacts, minified files, and lock/cache directories unless the user specifically wants those mapped. Include root `README` or architecture docs only when they explain entry points or repository purpose.

### 3. Write Directory Maps

For each relevant folder, create/update `codemap.md` with:

- Responsibility
- Design patterns
- Data/control flow
- Integration points
- Key files
- Testing/verification notes

### 4. Write Root Atlas

Root `codemap.md` should include:

- project responsibility
- entry points
- directory map with links to submaps
- major flows
- where to start for common tasks

### 5. Register Discovery

If appropriate, update `AGENTS.md`/`CLAUDE.md` with a short Repository Map section pointing to `codemap.md`.

Make registration idempotent: if a Repository Map section already exists, update or skip it instead of appending duplicates. Do not overwrite unrelated project instructions.

## Review Checklist

Before handoff:

- include/exclude patterns match core source/config only, unless user requested broader docs
- generated/vendor/test/build artifacts are not mapped as primary source
- root atlas links to directory maps that actually exist
- directory maps name responsibilities, flows, and integration points precisely
- state file was initialized/updated, or the reason is documented
- AGENTS/CLAUDE registration is idempotent and non-destructive

## Output

```markdown
Codemap updated:
- Root atlas:
- Submaps:
- State file:
- AGENTS/CLAUDE registration:
- Notes:
```
