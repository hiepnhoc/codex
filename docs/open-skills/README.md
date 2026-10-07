# HiGa Codex Dev Skills

Version: `0.2.0`

A curated engineering skill pack adapted for Codex. It combines workflow
routing, repository discovery, design and planning, implementation discipline,
verification, review, and specialist overlays without requiring OpenCode-only
agent aliases or tool APIs.

## Assessment

The source pack has strong coverage and useful safety gates. Its main weakness
was runtime coupling: OpenCode paths, named agents such as `@librarian` and
`@oracle`, a `WebSearch` tool assumption, custom frontmatter fields, and stale
manifest/install metadata. This conversion keeps the engineering content while
mapping those assumptions to Codex capabilities.

Two skills intentionally retain OpenCode commands because OpenCode is their
subject rather than their host runtime:

- `oh-my-opencode-slim`
- `release-smoke-test`

The OpenCode package and SDK examples in `clonedeps` are also intentional
dependency examples.

## Discovery

Codex discovers skills from:

```text
${CODEX_HOME:-~/.codex}/skills/<skill-name>/SKILL.md
<repo>/.agents/skills/<skill-name>/SKILL.md
```

Use the global root for this generic pack. Use `.agents/skills/` for stable
project-specific rules. Repository design, research, and plan artifacts use
`.agents/tasks/` so they are not confused with discoverable skills.

## Routing

Use `daily-dev` as the default router and load only the smallest applicable
workflow. High-signal routes include:

| Request | Primary route |
|---|---|
| Bug, regression, failing or flaky test | `diagnose` |
| Non-trivial feature or behavior change | `brainstorming` |
| Approved design needing a plan | `writing-plans` |
| Existing implementation plan | `executing-plans` |
| API, schema, adapter, public boundary | `api-and-interface-design` |
| User-facing UI | `frontend-ui-engineering` |
| Current framework/library facts | `source-driven-development` |
| Large unresolved effort | `zoom-out` |
| Review changes, commit, or range | `ocr-code-review` |
| Create or adapt skills | `writing-skills` |

See `ROUTING.md` for the complete map and runtime adaptation rules.

## Install

Validate and preview first:

```bash
cd docs/open-skills
python3 scripts/validate_pack.py
scripts/install.sh
```

Install globally:

```bash
scripts/install.sh --apply
```

The installer:

- defaults to `${CODEX_HOME:-$HOME/.codex}/skills`;
- validates the pack before writing;
- backs up every managed skill already present;
- replaces only the 43 skill directories listed by this pack;
- preserves `.system` and all unrelated/custom skills;
- prints the backup path for rollback.

Install into another Codex skill root when needed:

```bash
scripts/install.sh --target /path/to/skills --apply
```

## Rollback

Preview a rollback:

```bash
scripts/rollback.sh "$HOME/.codex/backups/open-skills/<timestamp>"
```

Restore skills that existed before installation while preserving newly added
pack skills:

```bash
scripts/rollback.sh "$HOME/.codex/backups/open-skills/<timestamp>" --apply
```

Restore the exact managed-skill state, including removal of pack skills that
did not exist at backup time:

```bash
scripts/rollback.sh "$HOME/.codex/backups/open-skills/<timestamp>" --apply --exact
```

## Optional Runtime Setup

`browser-testing-with-devtools` can use Chrome DevTools MCP when configured:

```bash
codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --autoConnect
```

This command can download and execute a package. Review and pin the dependency
before using it in sensitive environments. Playwright or another browser
runtime remains a valid fallback.

`ocr-code-review` includes its own pinned, approval-gated installer and safe
wrapper. It does not enable OCR-managed LLM review, an OpenCode plugin, or an
OCR MCP server by default.

## Maintenance

After changing a skill, regenerate and validate the manifest:

```bash
python3 scripts/validate_pack.py --write-manifest
python3 scripts/validate_pack.py
```

`AGENTS-snippet.md` contains compact routing instructions for another
repository. `AGENTS.md` contains rules for maintaining this source pack.
